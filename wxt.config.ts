import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'PromptTrace',
    description:
      'Local-first capture of AI workflow assets: mark text/images/videos as Input, Input Reference, Negative or Output and save them into a local, searchable Prompt Asset Library.',
    permissions: [
      'contextMenus',
      'downloads',
      'storage',
      'alarms',
      'activeTab',
      'scripting',
      'clipboardWrite',
    ],
    host_permissions: ['<all_urls>'],
    // default_popup + default_title are derived by WXT from the popup entrypoint
    // (entrypoints/popup, <title>PromptTrace</title>); the toolbar icon is set
    // explicitly here so it's used regardless of Chrome's icons-fallback.
    action: {
      default_icon: {
        '16': 'icon/16.png',
        '32': 'icon/32.png',
        '48': 'icon/48.png',
        '128': 'icon/128.png',
      },
    },
    commands: {
      'summon-toolbar': {
        // No default key: the in-page summon hotkey (Settings → 召喚鍵) is the
        // authoritative shortcut. Users may still bind a browser-level override
        // at chrome://extensions/shortcuts if a site swallows the in-page key.
        description: '在反白的文字（或游標下的圖片/影片）旁叫出角色選項',
      },
    },
  },
});
