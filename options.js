// Auto Tab Grouper - Options Page Script

class OptionsManager {
  constructor() {
    this.rules = {};
    this.settings = {};
    this.editingRule = null;
    this.init();
  }

  async init() {
    await this.loadSettings();
    this.setupEventListeners();
    this.updateUI();
  }

  async loadSettings() {
    try {
      const result = await chrome.storage.sync.get(['manualRules', 'settings']);
      this.rules = result.manualRules || {};
      this.settings = result.settings || {
        groupBySubdomain: true,
        defaultStrictMode: false,
        defaultMergeAcrossWindows: true
      };
    } catch (error) {
      console.warn('Sync storage unavailable, falling back to local storage:', error);
      const result = await chrome.storage.local.get(['manualRules', 'settings']);
      this.rules = result.manualRules || {};
      this.settings = result.settings || {
        groupBySubdomain: true,
        defaultStrictMode: false,
        defaultMergeAcrossWindows: true
      };
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

  setupEventListeners() {
    // Global settings toggles
    document.getElementById('groupBySubdomain').addEventListener('change', (e) => {
      this.settings.groupBySubdomain = e.target.checked;
      this.saveSettings();
    });

    document.getElementById('defaultStrictMode').addEventListener('change', (e) => {
      this.settings.defaultStrictMode = e.target.checked;
      this.saveSettings();
    });

    document.getElementById('defaultMergeAcrossWindows').addEventListener('change', (e) => {
      this.settings.defaultMergeAcrossWindows = e.target.checked;
      this.saveSettings();
    });

    // Rule management
    document.getElementById('addRule').addEventListener('click', () => {
      this.showRuleModal();
    });

    // Add first rule button (in empty state)
    document.getElementById('addFirstRule').addEventListener('click', () => {
      this.showRuleModal();
    });

    document.getElementById('closeModal').addEventListener('click', () => {
      this.hideRuleModal();
    });

    document.getElementById('cancelRule').addEventListener('click', () => {
      this.hideRuleModal();
    });

    document.getElementById('saveRule').addEventListener('click', () => {
      this.saveCurrentRule();
    });

    // Delete confirmation
    document.getElementById('cancelDelete').addEventListener('click', () => {
      this.hideDeleteModal();
    });

    document.getElementById('confirmDelete').addEventListener('click', () => {
      this.confirmDeleteRule();
    });

    // Import/Export
    document.getElementById('exportRules').addEventListener('click', () => {
      this.exportRules();
    });

    document.getElementById('importRules').addEventListener('click', () => {
      document.getElementById('importFile').click();
    });

    document.getElementById('importFile').addEventListener('change', (e) => {
      this.importRules(e.target.files[0]);
    });

    // Modal backdrop clicks
    document.getElementById('ruleModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.hideRuleModal();
      }
    });

    document.getElementById('deleteModal').addEventListener('click', (e) => {
      if (e.target === e.currentTarget) {
        this.hideDeleteModal();
      }
    });

    // Form validation
    document.getElementById('ruleDomain').addEventListener('input', () => {
      this.validateRuleForm();
    });

    document.getElementById('ruleGroupName').addEventListener('input', () => {
      this.validateRuleForm();
    });

    // Event delegation for dynamically created edit/delete buttons
    document.getElementById('rulesTable').addEventListener('click', (e) => {
      if (e.target.classList.contains('action-button')) {
        const action = e.target.dataset.action;
        const domain = e.target.dataset.domain;
        
        if (action === 'edit') {
          this.editRule(domain);
        } else if (action === 'delete') {
          this.deleteRule(domain);
        }
      }
    });
  }

  updateUI() {
    // Update global settings
    document.getElementById('groupBySubdomain').checked = this.settings.groupBySubdomain;
    document.getElementById('defaultStrictMode').checked = this.settings.defaultStrictMode;
    document.getElementById('defaultMergeAcrossWindows').checked = this.settings.defaultMergeAcrossWindows;

    // Update rules table
    this.updateRulesTable();
  }

  updateRulesTable() {
    const container = document.getElementById('rulesTable');
    const noRulesElement = document.getElementById('noRules');
    const ruleEntries = Object.entries(this.rules);

    if (ruleEntries.length === 0) {
      container.style.display = 'none';
      noRulesElement.style.display = 'block';
      return;
    }

    container.style.display = 'block';
    noRulesElement.style.display = 'none';

    const rulesHtml = ruleEntries.map(([domain, rule]) => {
      const strictBadge = rule.strictMode ? '<span class="badge strict">Strict</span>' : '';
      const mergeBadge = rule.mergeAcrossWindows ? '<span class="badge merge">Merge</span>' : '';
      
      return `
        <div class="rule-row" data-domain="${domain}">
          <div class="rule-info">
            <div class="rule-domain">${domain}</div>
            <div class="rule-group">→ ${rule.groupName}</div>
            <div class="rule-badges">${strictBadge}${mergeBadge}</div>
          </div>
          <div class="rule-actions">
            <button class="action-button edit" data-action="edit" data-domain="${domain}">✏️</button>
            <button class="action-button delete" data-action="delete" data-domain="${domain}">🗑️</button>
          </div>
        </div>
      `;
    }).join('');

    container.innerHTML = `
      <div class="rules-header">
        <span>Domain</span>
        <span>Actions</span>
      </div>
      ${rulesHtml}
    `;
  }

  showRuleModal(domain = null) {
    this.editingRule = domain;
    const modal = document.getElementById('ruleModal');
    const title = document.getElementById('modalTitle');
    
    if (domain) {
      title.textContent = 'Edit Rule';
      const rule = this.rules[domain];
      document.getElementById('ruleDomain').value = domain;
      document.getElementById('ruleGroupName').value = rule.groupName;
      document.getElementById('ruleStrictMode').checked = rule.strictMode || false;
      document.getElementById('ruleMergeAcrossWindows').checked = rule.mergeAcrossWindows || false;
    } else {
      title.textContent = 'Add New Rule';
      document.getElementById('ruleDomain').value = '';
      document.getElementById('ruleGroupName').value = '';
      document.getElementById('ruleStrictMode').checked = this.settings.defaultStrictMode;
      document.getElementById('ruleMergeAcrossWindows').checked = this.settings.defaultMergeAcrossWindows;
    }

    modal.style.display = 'flex';
    document.getElementById('ruleDomain').focus();
    this.validateRuleForm();
  }

  hideRuleModal() {
    document.getElementById('ruleModal').style.display = 'none';
    this.editingRule = null;
  }

  validateRuleForm() {
    const domain = document.getElementById('ruleDomain').value.trim();
    const groupName = document.getElementById('ruleGroupName').value.trim();
    const saveButton = document.getElementById('saveRule');
    
    const isValid = domain && groupName;
    saveButton.disabled = !isValid;
  }

  async saveCurrentRule() {
    const domain = document.getElementById('ruleDomain').value.trim().toLowerCase();
    const groupName = document.getElementById('ruleGroupName').value.trim();
    const strictMode = document.getElementById('ruleStrictMode').checked;
    const mergeAcrossWindows = document.getElementById('ruleMergeAcrossWindows').checked;

    if (!domain || !groupName) return;

    // Remove existing rule if editing and domain changed
    if (this.editingRule && this.editingRule !== domain) {
      delete this.rules[this.editingRule];
    }

    this.rules[domain] = {
      groupName,
      strictMode,
      mergeAcrossWindows
    };

    await this.saveSettings();
    this.updateRulesTable();
    this.hideRuleModal();
  }

  editRule(domain) {
    this.showRuleModal(domain);
  }

  deleteRule(domain) {
    const modal = document.getElementById('deleteModal');
    document.getElementById('deleteRuleDomain').textContent = domain;
    modal.style.display = 'flex';
    this.ruleToDelete = domain;
  }

  hideDeleteModal() {
    document.getElementById('deleteModal').style.display = 'none';
    this.ruleToDelete = null;
  }

  async confirmDeleteRule() {
    if (this.ruleToDelete) {
      delete this.rules[this.ruleToDelete];
      await this.saveSettings();
      this.updateRulesTable();
    }
    this.hideDeleteModal();
  }

  exportRules() {
    const data = {
      manualRules: this.rules,
      settings: this.settings,
      exportDate: new Date().toISOString(),
      version: "1.0.0"
    };

    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = `auto-tab-grouper-rules-${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async importRules(file) {
    if (!file) return;

    try {
      const text = await file.text();
      const data = JSON.parse(text);

      if (data.manualRules) {
        const confirmImport = confirm(
          `This will replace your current ${Object.keys(this.rules).length} rules with ${Object.keys(data.manualRules).length} imported rules. Continue?`
        );

        if (confirmImport) {
          this.rules = data.manualRules;
          if (data.settings) {
            this.settings = { ...this.settings, ...data.settings };
          }
          await this.saveSettings();
          this.updateUI();
          alert('Rules imported successfully!');
        }
      } else {
        alert('Invalid file format. Please select a valid Auto Tab Grouper export file.');
      }
    } catch (error) {
      alert('Error reading file. Please make sure it\'s a valid JSON file.');
      console.error('Import error:', error);
    }

    // Reset file input
    document.getElementById('importFile').value = '';
  }
}

// Initialize options manager
let optionsManager;
document.addEventListener('DOMContentLoaded', () => {
  optionsManager = new OptionsManager();
});