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
      'sidePanel',
      'activeTab',
      'scripting',
      'clipboardWrite',
    ],
    host_permissions: ['<all_urls>'],
    action: {
      default_title: 'PromptTrace — open side panel',
    },
    commands: {
      'summon-toolbar': {
        suggested_key: { default: 'Alt+S' },
        description: '在反白的文字（或游標下的圖片/影片）旁叫出角色選項',
      },
    },
  },
});
