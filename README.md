# Auto Tab Grouper

A Chrome extension that automatically groups tabs by domain with manual rules support, strict mode, and cross-window merging capabilities.

## Features

### Core Functionality
- **Automatic Domain Grouping**: Groups tabs by their domain (e.g., all `youtube.com` tabs)
- **Manual Rules**: Override automatic grouping with custom domain → group name mappings
- **Priority System**: Manual rules always take precedence over automatic domain grouping

### Advanced Behaviors
- **Strict Mode**: Automatically remove tabs from groups when their URL changes to a different domain
- **Merge Mode**: Prevent duplicate groups across windows by merging tabs into existing groups
- **Subdomain Control**: Option to group by full subdomain or base domain only

### User Interface
- **Popup**: Quick access to organize tabs and toggle global settings
- **Options Page**: Comprehensive rule management with import/export functionality
- **Real-time Updates**: Changes apply immediately without requiring page reloads

## Installation

### Load Unpacked (Development)

1. **Download/Clone** this repository to your local machine
2. **Open Chrome** and navigate to `chrome://extensions/`
3. **Enable Developer Mode** by toggling the switch in the top right corner
4. **Click "Load unpacked"** and select the `AutoTabGrouper` folder
5. **Pin the extension** (optional) by clicking the puzzle piece icon and pinning "Auto Tab Grouper"

<!-- ### Manual Installation Steps

```bash
# Clone the repository
git clone <repository-url>
cd AutoTabGrouper

# Or download and extract the ZIP file
# No build process required - ready to load!
``` -->

<!-- ## Quick Start

### First Time Setup

1. **Install the extension** using the steps above
2. **Click the extension icon** in your toolbar to open the popup
3. **Click "Manage Rules"** to open the options page
4. **Add your first rule**:
   - Domain: `docs.google.com`
   - Group Name: `Work`
   - Enable "Merge Across Windows" if desired
5. **Click "Organize Now"** to group existing tabs -->

### Default Rules

The extension starts with **no manual rules** - it uses pure auto-grouping by domain initially. You can add custom rules through the Options page:

1. Click the extension icon → "Manage Rules"
2. Click "Add Rule" to create your first manual rule
3. Manual rules will override auto-grouping for matching domains

## Testing Guide

### Basic Functionality Tests

#### Test 1: Automatic Domain Grouping
1. Open several tabs from the same domain (e.g., multiple YouTube videos)
2. Click the extension icon and press "Organize Now"
3. **Expected**: All YouTube tabs should be grouped under "youtube.com"

#### Test 2: Manual Rules Override
1. Navigate to `docs.google.com` in a new tab
2. Click "Organize Now"
3. **Expected**: The tab should be grouped under "Work" (not "docs.google.com")

#### Test 3: Rule Priority
1. Create a manual rule for `example.com` → "Testing"
2. Open multiple `example.com` tabs
3. **Expected**: Tabs should group under "Testing", not "example.com"

### Advanced Feature Tests

#### Test 4: Strict Mode
1. Create a rule with Strict Mode enabled
2. Open a tab matching that rule (gets grouped)
3. Navigate that tab to a different domain
4. **Expected**: Tab should be automatically ungrouped

#### Test 5: Merge Across Windows
1. Create a rule with Merge Mode enabled
2. Open a tab matching that rule in Window 1
3. Open another matching tab in Window 2
4. **Expected**: Second tab should move to the group in Window 1

#### Test 6: Global Settings
1. Toggle "Group by Subdomain" off
2. Open tabs from `mail.google.com` and `drive.google.com`
3. **Expected**: Both should group under "google.com"

### Import/Export Tests

#### Test 7: Export Rules
1. Configure several custom rules
2. Go to Options → Export Rules
3. **Expected**: JSON file downloads with your rules

#### Test 8: Import Rules
1. Create a backup JSON file with test rules
2. Use Options → Import Rules
3. **Expected**: Rules are loaded and applied immediately

### Edge Case Tests

#### Test 9: Group Name Conflicts
1. Create two rules with the same group name but different domains
2. Open tabs matching both rules
3. **Expected**: Tabs from both domains appear in the same group

#### Test 10: Invalid URLs
1. Navigate to `chrome://extensions/` or other chrome:// pages
2. Click "Organize Now"
3. **Expected**: Chrome internal pages should be ignored (not grouped)

## Usage Examples

### Example 1: Work Setup
```json
{
  "docs.google.com": { "groupName": "Work", "mergeAcrossWindows": true },
  "slack.com": { "groupName": "Work", "mergeAcrossWindows": true },
  "zoom.us": { "groupName": "Work", "mergeAcrossWindows": true }
}
```

### Example 2: Development Workflow
```json
{
  "github.com": { "groupName": "Code", "strictMode": true },
  "stackoverflow.com": { "groupName": "Reference", "strictMode": false },
  "localhost": { "groupName": "Development", "strictMode": true }
}
```

### Example 3: Entertainment & News
```json
{
  "youtube.com": { "groupName": "Entertainment", "strictMode": true },
  "netflix.com": { "groupName": "Entertainment", "strictMode": true },
  "reddit.com": { "groupName": "Social", "mergeAcrossWindows": false }
}
```

## Configuration Files

### Default Rules (`rules.json`)
The extension loads default rules from `rules.json` on first install. You can modify this file before loading the extension to customize the initial setup.

### Storage
- Settings are stored using `chrome.storage.sync` (syncs across devices)
- Falls back to `chrome.storage.local` if sync is unavailable
- Changes apply immediately without restart

## Troubleshooting

### Common Issues

**Extension not working after installation**
- Ensure you've enabled "Developer mode" in `chrome://extensions/`
- Check the console for any error messages
- Try reloading the extension

**Rules not applying**
- Check that the domain format is correct (no `http://` or `www.`)
- Use "Organize Now" to manually trigger grouping
- Verify rules in the Options page

**Groups not merging across windows**
- Ensure "Merge Across Windows" is enabled for the rule
- Check that the group names match exactly (case-sensitive)

**Strict mode not working**
- Verify "Strict Mode" is enabled for the rule or globally
- Changes only apply to tabs that navigate to different domains
- Tabs in manually created groups may not be affected

### Debug Information

To view debug information:
1. Open `chrome://extensions/`
2. Click "Details" on Auto Tab Grouper
3. Click "Inspect views: service worker"
4. Check the Console tab for any error messages

## Development

### File Structure
```
AutoTabGrouper/
├── manifest.json          # Extension manifest (Manifest V3)
├── background.js          # Service worker with core logic
├── popup.html/js/css      # Extension popup interface
├── options.html/js/css    # Options page for rule management
├── rules.json            # Default rules and settings
├── icons/                # Extension icons
└── README.md            # This file
```

### Key Classes and Functions

**AutoTabGrouper** (background.js)
- `groupTabsInWindow()`: Groups tabs in a specific window
- `findMatchingRule()`: Matches hostnames to rules
- `handleTabUpdate()`: Processes tab URL changes for strict mode

**PopupManager** (popup.js)
- `organizeAllTabs()`: Triggers manual organization
- `updateUI()`: Refreshes popup display

**OptionsManager** (options.js)
- `saveCurrentRule()`: Adds/edits rules
- `importRules()`: Imports rules from JSON
- `exportRules()`: Exports rules to JSON

## Browser Compatibility

- **Chrome**: Version 88+ (Manifest V3 support)
- **Edge**: Version 88+ (Chromium-based)
- **Other Chromium browsers**: Should work with Manifest V3 support

## Privacy

- No data is sent to external servers
- All settings stored locally or synced via Chrome's built-in sync
- No tracking or analytics

## License

This project is provided as-is for educational and personal use.

## Support

For issues, questions, or feature requests:
1. Check the troubleshooting section above
2. Review the testing guide to ensure proper setup
3. Check browser console for error messages