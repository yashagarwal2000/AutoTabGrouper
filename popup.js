// Auto Tab Grouper - Popup Script

class PopupManager {
  constructor() {
    this.rules = {};
    this.settings = {};
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    this.updateUI();
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
      const response = await chrome.runtime.sendMessage({ action: 'getSettings' });
      this.rules = response.rules || {};
      this.settings = this.mergeSettings(response.settings);
    } catch (error) {
      console.warn('Error loading settings:', error);
      this.settings = this.mergeSettings();
    }
  }

  setupEventListeners() {
    // Organize Now button with enhanced feedback
    document.getElementById('organizeNow').addEventListener('click', async (event) => {
      const button = event.target;
      const originalText = button.textContent;
      
      // Immediate visual feedback
      button.textContent = '🔄 Organizing...';
      button.disabled = true;
      button.style.opacity = '0.7';
      
      const startTime = performance.now();

      try {
        await chrome.runtime.sendMessage({ action: 'organizeNow' });
        
        const duration = performance.now() - startTime;
        button.textContent = `✅ Done! (${Math.round(duration)}ms)`;
        button.style.backgroundColor = '#4CAF50';
        button.style.color = 'white';
        
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
          button.style.opacity = '1';
          button.style.backgroundColor = '';
          button.style.color = '';
        }, 2000);
      } catch (error) {
        console.error('Error organizing tabs:', error);
        button.textContent = '❌ Error - Try Again';
        button.style.backgroundColor = '#f44336';
        button.style.color = 'white';
        
        setTimeout(() => {
          button.textContent = originalText;
          button.disabled = false;
          button.style.opacity = '1';
          button.style.backgroundColor = '';
          button.style.color = '';
        }, 3000);
      }
    });

    // Global Strict Mode toggle
    document.getElementById('strictMode').addEventListener('change', async (e) => {
      this.settings.defaultStrictMode = e.target.checked;
      await this.saveSettings();
    });

    // Global Merge Mode toggle
    document.getElementById('mergeMode').addEventListener('change', async (e) => {
      this.settings.defaultMergeAcrossWindows = e.target.checked;
      await this.saveSettings();
    });

    // Open Options button
    document.getElementById('openOptions').addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
      window.close();
    });
  }

  async saveSettings() {
    try {
      await chrome.runtime.sendMessage({ 
        action: 'updateSettings', 
        settings: this.settings 
      });
    } catch (error) {
      console.warn('Error saving settings:', error);
    }
  }

  updateUI() {
    // Update toggle states
    document.getElementById('strictMode').checked = this.settings.defaultStrictMode || false;
    document.getElementById('mergeMode').checked = this.settings.defaultMergeAcrossWindows || false;

    // Update rules preview
    this.updateRulesPreview();
  }

  updateRulesPreview() {
    const container = document.getElementById('rulesPreview');
    const ruleEntries = Object.entries(this.rules);

    if (ruleEntries.length === 0) {
      container.innerHTML = '<div class="no-rules">No manual rules configured</div>';
      return;
    }

    const maxPreview = 3;
    const rulesToShow = ruleEntries.slice(0, maxPreview);
    const hasMore = ruleEntries.length > maxPreview;

    const rulesHtml = rulesToShow.map(([domain, rule]) => {
      const badges = [];
      if (rule.strictMode) badges.push('<span class="badge strict">Strict</span>');
      if (rule.mergeAcrossWindows) badges.push('<span class="badge merge">Merge</span>');
      
      return `
        <div class="rule-item">
          <div class="rule-domain">${domain}</div>
          <div class="rule-group">→ ${rule.groupName}</div>
          <div class="rule-badges">${badges.join('')}</div>
        </div>
      `;
    }).join('');

    const moreText = hasMore ? `<div class="more-rules">+${ruleEntries.length - maxPreview} more rules</div>` : '';

    container.innerHTML = rulesHtml + moreText;
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new PopupManager();
});