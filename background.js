// Auto Tab Grouper - Background Service Worker
// Handles automatic tab grouping with manual rules, strict mode, and merge mode

class AutoTabGrouper {
  constructor() {
    this.rules = {};
    this.settings = {};
    this.groupingTimeouts = new Map();
    this.isGrouping = false; // Prevent infinite loops
    this.hostnameCache = new Map(); // Cache for hostname extraction
    this.groupCache = new Map(); // Cache for group information by window
    this.pendingTabs = new Map(); // Track tabs waiting to be grouped
    
    // Object pooling for better memory management
    this.configPool = new TabConfigPool();
    this.smartCache = new SmartCache(1000);
    this.performanceTracker = new PerformanceTracker();
    
    // Pre-compiled regex patterns for performance
    this.CHROME_URLS = /^(chrome|about|moz-extension):/;
    this.HTTP_URLS = /^https?:/;
    
    // Pre-processed rules for faster matching
    this.ruleKeys = []; // Cached array of rule keys
    this.hasRules = false; // Quick check flag
    
    this.init();
  }

  async init() {
    // Check if required APIs are available
    if (!chrome.tabs || !chrome.tabGroups || !chrome.storage) {
      console.error('Required Chrome APIs not available');
      return;
    }
    
    await this.loadSettings();
    this.setupEventListeners();
    await this.seedDefaultRules();
    this.startCacheCleanup(); // Prevent memory leaks
  }

  startCacheCleanup() {
    // Clean up old cache entries every 5 minutes
    setInterval(() => {
      const now = Date.now();
      const maxAge = 5 * 60 * 1000; // 5 minutes
      
      // Clean old hostname cache if it gets too large
      if (this.hostnameCache.size > 100) {
        this.hostnameCache.clear();
      }
      
      // Clean group cache entries older than maxAge
      for (const [key, value] of this.groupCache.entries()) {
        if (value.timestamp && (now - value.timestamp) > maxAge) {
          this.groupCache.delete(key);
        }
      }
      
      // Clean smart cache if it gets too large
      if (this.smartCache.cache.size > 2000) {
        // Keep only rule cache entries and recent hostname cache
        const ruleCacheEntries = new Map();
        for (const [key, value] of this.smartCache.cache) {
          if (key.startsWith('rule_')) {
            ruleCacheEntries.set(key, value);
          }
        }
        this.smartCache.clear();
        for (const [key, value] of ruleCacheEntries) {
          this.smartCache.set(key, value);
        }
      }
    }, 5 * 60 * 1000);
  }

  getDefaultSettings() {
    return {
      groupBySubdomain: true,
      defaultStrictMode: false,
      defaultMergeAcrossWindows: true
    };
  }

  mergeSettings(stored) {
    return {
      ...this.getDefaultSettings(),
      ...(stored || {})
    };
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['manualRules', 'settings']);
      this.rules = result.manualRules || {};
      this.settings = this.mergeSettings(result.settings);
      
      // Pre-process rules for faster matching
      this.updateRuleCache();
      
    } catch (error) {
      console.warn('Sync storage unavailable, falling back to local storage:', error);
      const result = await chrome.storage.local.get(['manualRules', 'settings']);
      this.rules = result.manualRules || {};
      this.settings = this.mergeSettings(result.settings);
      
      // Pre-process rules for faster matching
      this.updateRuleCache();
    }
  }

  updateRuleCache() {
    this.ruleKeys = Object.keys(this.rules);
    this.hasRules = this.ruleKeys.length > 0;
    
    // Clear rule cache when rules change
    for (const [key] of this.smartCache.cache) {
      if (key.startsWith('rule_')) {
        this.smartCache.cache.delete(key);
      }
    }
  }

  async saveSettings() {
    const data = {
      manualRules: this.rules,
      settings: this.settings
    };
    
    try {
      await chrome.storage.sync.set(data);
    } catch (error) {
      console.warn('Sync storage unavailable, falling back to local storage:', error);
      await chrome.storage.local.set(data);
    }
  }

  async seedDefaultRules() {
    // Only seed settings if they don't exist, skip manual rules for now
    if (Object.keys(this.settings).length === 0) {
      try {
        const response = await fetch(chrome.runtime.getURL('rules.json'));
        const defaultData = await response.json();
        // Only load settings, not manual rules
        this.settings = { ...this.settings, ...defaultData.settings };
        await this.saveSettings();
      } catch (error) {
        console.warn('Could not load default settings:', error);
      }
    }
  }

  setupEventListeners() {
    try {
      // Group new tabs
      if (chrome.tabs && chrome.tabs.onCreated) {
        chrome.tabs.onCreated.addListener((tab) => {
          // Only group if tab already has a meaningful URL
          if (tab.url && !this.CHROME_URLS.test(tab.url)) {
            this.debounceGrouping(tab.windowId, 'single_tab'); // Immediate for new tabs
          }
        });
      }

      // Handle URL changes for strict mode AND new tab navigation
      if (chrome.tabs && chrome.tabs.onUpdated) {
        chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
          if (changeInfo.url && tab.url && !this.CHROME_URLS.test(tab.url)) {
            // Predictive grouping: start as soon as URL changes
            if (changeInfo.status === 'loading' && changeInfo.url) {
              this.debounceGrouping(tab.windowId, 'navigation'); // Fast grouping
            } else if (changeInfo.status === 'complete') {
              this.debounceGrouping(tab.windowId, 'navigation'); // Quick cleanup
            }
            
            // Handle strict mode separately
            if (this.shouldHandleStrictMode(tab)) {
              this.handleTabUpdate(tab);
            }
          }
        });
      }

      // Also group when tabs are activated (focused) - minimal delay
      if (chrome.tabs && chrome.tabs.onActivated) {
        chrome.tabs.onActivated.addListener(async (activeInfo) => {
          try {
            const tab = await chrome.tabs.get(activeInfo.tabId);
            if (tab.url && !this.CHROME_URLS.test(tab.url)) {
              // Only group if tab isn't already grouped correctly
              const groupConfig = this.getGroupNameForTab(tab);
              if (groupConfig && tab.groupId === chrome.tabGroups.TAB_GROUP_ID_NONE) {
                this.debounceGrouping(activeInfo.windowId, 'activation'); // Smart activation delay
              }
            }
          } catch (error) {
            // Tab might not exist anymore
          }
        });
      }

      // Listen for storage changes from options page
      if (chrome.storage && chrome.storage.onChanged) {
        chrome.storage.onChanged.addListener((changes, namespace) => {
          if (changes.manualRules) {
            this.rules = changes.manualRules.newValue || {};
            this.updateRuleCache(); // Update cache when rules change
          }
          if (changes.settings) {
            this.settings = this.mergeSettings(changes.settings.newValue);
          }
        });
      }

      // Handle messages from popup
      if (chrome.runtime && chrome.runtime.onMessage) {
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
          this.handleMessage(message, sender, sendResponse);
          return true; // Required for async response
        });
      }
    } catch (error) {
      console.error('Error setting up event listeners:', error);
    }
  }

  async handleMessage(message, sender, sendResponse) {
    try {
      switch (message.action) {
        case 'organizeNow':
          await this.organizeAllTabs();
          sendResponse({ success: true });
          break;
        case 'getSettings':
          sendResponse({ rules: this.rules, settings: this.settings });
          break;
        case 'updateSettings':
          this.settings = this.mergeSettings({ ...this.settings, ...message.settings });
          await this.saveSettings();
          sendResponse({ success: true });
          break;
        default:
          sendResponse({ error: 'Unknown action' });
      }
    } catch (error) {
      console.error('Error handling message:', error);
      sendResponse({ error: error.message });
    }
  }

  debounceGrouping(windowId, context = 'default') {
    // Track pending tabs for this window
    const currentPending = this.pendingTabs.get(windowId) || 0;
    this.pendingTabs.set(windowId, currentPending + 1);

    if (this.groupingTimeouts.has(windowId)) {
      clearTimeout(this.groupingTimeouts.get(windowId));
    }

    // Get optimal delay based on context
    const delay = this.getOptimalDelay(context, currentPending);

    // For single tab changes, group immediately
    if (currentPending === 0 && context === 'single_tab') {
      this.pendingTabs.delete(windowId);
      this.performanceTracker.start('grouping_immediate');
      this.groupTabsInWindow(windowId).then(() => {
        this.performanceTracker.end('grouping_immediate');
      });
      return;
    }

    // For multiple changes, use adaptive delay to batch
    const timeout = setTimeout(async () => {
      this.pendingTabs.delete(windowId);
      this.performanceTracker.start('grouping_batch');
      await this.groupTabsInWindow(windowId);
      this.performanceTracker.end('grouping_batch');
      this.groupingTimeouts.delete(windowId);
    }, delay);

    this.groupingTimeouts.set(windowId, timeout);
  }

  getOptimalDelay(context, pendingCount = 0) {
    switch (context) {
      case 'single_tab': return pendingCount === 0 ? 0 : 10;    // Instant for single changes
      case 'navigation': return 15;    // Fast for page navigation  
      case 'bulk_operation': return 30; // Batch for multiple changes
      case 'background': return 100;   // Slower for background events
      case 'activation': return pendingCount === 0 ? 50 : 20; // Smart activation delay
      default: return 25;
    }
  }

  extractHostname(url) {
    // Check smart cache first
    const cached = this.smartCache.get(url);
    if (cached !== null) return cached;

    // Fast pre-check for non-HTTP URLs
    if (!this.HTTP_URLS.test(url)) {
      this.smartCache.set(url, null);
      return null;
    }

    try {
      // Fast hostname extraction using indexOf instead of URL parsing
      const startIdx = url.indexOf('://') + 3;
      const endIdx = url.indexOf('/', startIdx);
      const hostname = endIdx === -1 ? url.slice(startIdx) : url.slice(startIdx, endIdx);
      
      // Remove port if present
      const colonIdx = hostname.indexOf(':');
      const cleanHostname = colonIdx !== -1 ? hostname.slice(0, colonIdx) : hostname;
      
      // Remove www prefix inline
      const result = cleanHostname.startsWith('www.') ? cleanHostname.slice(4) : cleanHostname;
      
      // Cache the result
      this.smartCache.set(url, result);
      return result;
    } catch (error) {
      this.smartCache.set(url, null);
      return null;
    }
  }

  findMatchingRule(hostname) {
    if (!hostname || !this.hasRules) return null;

    // Check smart cache first for rule results
    const cacheKey = `rule_${hostname}`;
    const cached = this.smartCache.get(cacheKey);
    if (cached !== null) return cached;

    // Exact match first (fastest)
    if (this.rules[hostname]) {
      const result = { key: hostname, rule: this.rules[hostname] };
      this.smartCache.set(cacheKey, result);
      return result;
    }

    // Optimized suffix match using pre-cached keys
    for (let i = 0; i < this.ruleKeys.length; i++) {
      const ruleKey = this.ruleKeys[i];
      if (hostname.endsWith(ruleKey)) {
        const result = { key: ruleKey, rule: this.rules[ruleKey] };
        this.smartCache.set(cacheKey, result);
        return result;
      }
    }

    // Cache negative result to avoid future lookups
    this.smartCache.set(cacheKey, null);
    return null;
  }

  getGroupNameForTab(tab) {
    const hostname = this.extractHostname(tab.url);
    if (!hostname) return null;

    // Get pooled config object
    const config = this.configPool.get();

    // Check manual rules first (if any exist) - optimized with cache
    const matchingRule = this.findMatchingRule(hostname);
    if (matchingRule) {
      config.groupName = matchingRule.rule.groupName;
      config.strictMode = matchingRule.rule.strictMode ?? this.settings.defaultStrictMode;
      config.mergeAcrossWindows = matchingRule.rule.mergeAcrossWindows ?? this.settings.defaultMergeAcrossWindows;
      config.isManualRule = true;
      return config; // Don't pool this one since it's returned
    }

    // Fallback to auto-grouping by domain
    let groupName;
    if (this.settings.groupBySubdomain) {
      // Keep subdomain but use clean name: music.youtube.com → music.youtube
      const parts = hostname.split('.');
      if (parts.length >= 2) {
        // Remove the TLD (.com, .org, etc.)
        groupName = parts.slice(0, -1).join('.');
      } else {
        groupName = hostname;
      }
    } else {
      // Use just the main domain name: youtube.com → youtube
      groupName = this.getBaseDomain(hostname);
    }
    
    config.groupName = groupName;
    config.strictMode = this.settings.defaultStrictMode;
    config.mergeAcrossWindows = this.settings.defaultMergeAcrossWindows;
    config.isManualRule = false;
    
    return config; // Don't pool this one since it's returned
  }

  getBaseDomain(hostname) {
    const parts = hostname.split('.');
    if (parts.length >= 2) {
      // Extract just the name part (remove .com, .org, etc.)
      const domainName = parts[parts.length - 2];
      return domainName;
    }
    return hostname;
  }

  async findGroupIdByTitle(title, windowId = null) {
    try {
      // More efficient: query specific window if provided
      const groups = windowId ? 
        await chrome.tabGroups.query({ windowId }) : 
        await chrome.tabGroups.query({});
        
      const group = groups.find(g => g.title === title);
      return group ? group.id : null;
    } catch (error) {
      console.error('Error finding group:', error);
      return null;
    }
  }

  async shouldMoveToExistingGroup(groupName, currentWindowId) {
    try {
      // Get all groups across windows
      const allGroups = await chrome.tabGroups.query({});
      const existingGroup = allGroups.find(g => g.title === groupName && g.windowId !== currentWindowId);
      return existingGroup ? existingGroup.id : null;
    } catch (error) {
      console.error('Error checking for existing group:', error);
      return null;
    }
  }

  async groupTabsInWindow(windowId) {
    if (this.isGrouping) {
      return;
    }
    
    this.isGrouping = true;
    
    try {
      // Quick early exit checks
      const ungroupedCount = await this.getUngroupedTabCount(windowId);
      
      if (ungroupedCount === 0) {
        return; // Nothing to do!
      }

      this.performanceTracker.start('total_grouping');

      // Check cache first for window signature
      const cacheKey = `window_${windowId}`;
      const currentSignature = await this.getWindowSignature(windowId);
      const cachedData = this.groupCache.get(cacheKey);
      
      if (cachedData && cachedData.signature === currentSignature) {
        return; // No changes needed!
      }

      // Get tabs and existing groups in parallel
      const [tabs, existingGroups] = await Promise.all([
        chrome.tabs.query({ windowId, url: ['http://*/*', 'https://*/*'] }),
        chrome.tabGroups.query({ windowId })
      ]);

      // Update cache
      this.groupCache.set(cacheKey, { 
        signature: currentSignature,
        timestamp: Date.now() 
      });

      // Create a map of existing groups for fast lookup
      const groupMap = new Map();
      existingGroups.forEach(group => {
        groupMap.set(group.title, group.id);
      });

      const tabsToGroup = new Map(); // groupName -> {tabs, config}
      const correctlyGroupedTabs = new Set(); // Track tabs already in correct groups

      // Pre-allocate arrays for better performance
      const tabConfigs = new Array(tabs.length);
      
      for (let i = 0; i < tabs.length; i++) {
        const tab = tabs[i];
        const groupConfig = this.getGroupNameForTab(tab);
        tabConfigs[i] = groupConfig;
        
        if (!groupConfig || !groupConfig.groupName) {
          continue;
        }

        // Quick check if already in correct group
        if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
          try {
            const currentGroup = existingGroups.find(g => g.id === tab.groupId);
            if (currentGroup && currentGroup.title === groupConfig.groupName) {
              correctlyGroupedTabs.add(tab.id);
              continue; // Already in correct group
            }
          } catch {
            // Group doesn't exist anymore, proceed with grouping
          }
        }

        // Only group ungrouped tabs or tabs in wrong groups
        if (!correctlyGroupedTabs.has(tab.id)) {
          if (!tabsToGroup.has(groupConfig.groupName)) {
            tabsToGroup.set(groupConfig.groupName, { tabs: [], config: groupConfig });
          }
          tabsToGroup.get(groupConfig.groupName).tabs.push(tab);
        }
      }

      // Skip processing if no tabs need grouping
      if (tabsToGroup.size === 0) {
        return;
      }

      // Enhanced batch processing with optimized concurrency
      await this.processAllGroups(tabsToGroup, windowId, groupMap);

      this.performanceTracker.end('total_grouping');

    } catch (error) {
      console.error('Error grouping tabs:', error);
    } finally {
      this.isGrouping = false;
    }
  }

  async getUngroupedTabCount(windowId) {
    try {
      const tabs = await chrome.tabs.query({windowId, groupId: chrome.tabGroups.TAB_GROUP_ID_NONE});
      return tabs.filter(tab => this.HTTP_URLS.test(tab.url)).length;
    } catch {
      return 0;
    }
  }

  async getWindowSignature(windowId) {
    try {
      const [tabs, groups] = await Promise.all([
        chrome.tabs.query({ windowId }),
        chrome.tabGroups.query({ windowId })
      ]);
      
      const tabSignature = tabs.map(t => `${t.id}:${t.groupId}:${this.extractHostname(t.url) || 'unknown'}`).sort().join('|');
      const groupSignature = groups.map(g => `${g.id}:${g.title}`).sort().join('|');
      
      return `${tabSignature}::${groupSignature}`;
    } catch {
      return Date.now().toString(); // Fallback to always process
    }
  }

  async processAllGroups(tabsToGroup, windowId, groupMap) {
    const createOperations = [];
    const moveOperations = [];
    
    // Separate operations by type for better batching
    for (const [groupName, {tabs, config}] of tabsToGroup) {
      if (tabs.length === 0) continue;
      
      const tabIds = tabs.map(t => t.id);
      
      if (groupMap.has(groupName)) {
        moveOperations.push({
          groupId: groupMap.get(groupName), 
          tabIds,
          groupName
        });
      } else {
        createOperations.push({
          tabIds, 
          groupName,
          windowId,
          config
        });
      }
    }
    
    // Ultra-fast processing: Prioritize moves over creates
    if (moveOperations.length > 0) {
      // Move operations are faster, do them first
      await Promise.all(moveOperations.map(op => this.moveToGroupOptimized(op)));
    }
    
    if (createOperations.length > 0) {
      // Create operations in smaller parallel batches
      const maxConcurrent = 2; // Reduced for stability
      for (let i = 0; i < createOperations.length; i += maxConcurrent) {
        const batch = createOperations.slice(i, i + maxConcurrent);
        await Promise.all(batch.map(op => this.createGroupOptimized(op, groupMap)));
      }
    }
  }

  async createGroupOptimized(operation, groupMap) {
    try {
      const { tabIds, groupName, windowId } = operation;
      const targetGroupId = await chrome.tabs.group({ 
        tabIds, 
        createProperties: { windowId } 
      });
      
      await chrome.tabGroups.update(targetGroupId, { title: groupName });
      groupMap.set(groupName, targetGroupId); // Update cache
      
      return targetGroupId;
    } catch (error) {
      console.error('Error creating group:', error);
    }
  }

  async moveToGroupOptimized(operation) {
    try {
      const { groupId, tabIds } = operation;
      await chrome.tabs.group({ tabIds, groupId });
    } catch (error) {
      console.error('Error moving to group:', error);
    }
  }

  async processGroup(groupName, tabs, config, windowId, groupMap) {
    try {
      let targetGroupId = null;

      // Check for merge mode first
      if (config.mergeAcrossWindows) {
        const existingGroupId = await this.shouldMoveToExistingGroup(groupName, windowId);
        if (existingGroupId) {
          const tabIds = tabs.map(t => t.id);
          await chrome.tabs.group({ tabIds, groupId: existingGroupId });
          return;
        }
      }

      // Use pre-fetched group map for faster lookup
      targetGroupId = groupMap.get(groupName);
      
      const tabIds = tabs.map(t => t.id);
      
      if (!targetGroupId) {
        // Create new group
        targetGroupId = await chrome.tabs.group({ tabIds, createProperties: { windowId } });
        await chrome.tabGroups.update(targetGroupId, { title: groupName });
        groupMap.set(groupName, targetGroupId); // Update cache
      } else {
        // Add to existing group
        await chrome.tabs.group({ tabIds, groupId: targetGroupId });
      }
    } catch (error) {
      console.error('Error processing group:', error);
    }
  }

  shouldHandleStrictMode(tab) {
    // Only handle strict mode for tabs that are already grouped
    return tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE;
  }

  async handleTabUpdate(tab) {
    const groupConfig = this.getGroupNameForTab(tab);
    if (!groupConfig) return;

    const isStrictMode = groupConfig.strictMode;
    if (!isStrictMode) return;

    // Check if tab is in a group
    if (tab.groupId !== chrome.tabGroups.TAB_GROUP_ID_NONE) {
      try {
        const currentGroup = await chrome.tabGroups.get(tab.groupId);
        
        // If tab's new URL doesn't match current group, ungroup it
        if (currentGroup.title !== groupConfig.groupName) {
          await chrome.tabs.ungroup([tab.id]);
          
          // Optionally regroup according to new URL
          setTimeout(() => {
            this.debounceGrouping(tab.windowId, 100);
          }, 100);
        }
      } catch (error) {
        console.error('Error handling tab update:', error);
      }
    }
  }

  async organizeAllTabs() {
    try {
      const windows = await chrome.windows.getAll();
      for (const window of windows) {
        await this.groupTabsInWindow(window.id);
      }
    } catch (error) {
      console.error('Error organizing all tabs:', error);
    }
  }
}

// Performance and Memory Optimization Classes
class TabConfigPool {
  constructor() {
    this.pool = [];
    this.maxSize = 50;
  }
  
  get() {
    return this.pool.pop() || {
      groupName: '',
      strictMode: false,
      mergeAcrossWindows: false,
      isManualRule: false
    };
  }
  
  release(config) {
    if (this.pool.length < this.maxSize) {
      // Reset object for reuse
      config.groupName = '';
      config.strictMode = false;
      config.mergeAcrossWindows = false;
      config.isManualRule = false;
      this.pool.push(config);
    }
  }
}

class SmartCache {
  constructor(maxSize = 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.accessOrder = new Set(); // Track access for LRU
  }
  
  get(key) {
    if (this.cache.has(key)) {
      // Move to end (most recently used)
      this.accessOrder.delete(key);
      this.accessOrder.add(key);
      return this.cache.get(key);
    }
    return null;
  }
  
  set(key, value) {
    // Remove oldest if at capacity
    if (this.cache.size >= this.maxSize) {
      const oldest = this.accessOrder.values().next().value;
      this.accessOrder.delete(oldest);
      this.cache.delete(oldest);
    }
    
    this.cache.set(key, value);
    this.accessOrder.add(key);
  }
  
  clear() {
    this.cache.clear();
    this.accessOrder.clear();
  }
}

class PerformanceTracker {
  constructor() {
    this.metrics = new Map();
  }
  
  start(operation) {
    this.metrics.set(operation, performance.now());
  }
  
  end(operation) {
    const startTime = this.metrics.get(operation);
    if (startTime) {
      const duration = performance.now() - startTime;
      // Only log slow operations
        if (duration > 50) {
            console.log(`${operation}: ${duration.toFixed(2)}ms`);
        }
      this.metrics.delete(operation);
      return duration;
    }
  }
}

// Initialize the extension
try {
  const autoTabGrouper = new AutoTabGrouper();
} catch (error) {
  console.error('Failed to initialize Auto Tab Grouper:', error);
}