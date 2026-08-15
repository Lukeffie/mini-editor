const KEY = "mini-editor-settings";
const defaults = {
  ratio: 50,
  theme: "light",
  fontSize: 14,
  autoSave: false,
  lastDir: null, // 上次打开的目录
  mode: "edit", // "edit" | "browse"
  toolbarHidden: false, // 浏览模式工具栏是否收起
  lastDownloadDir: null, // 上次下载目录（会话内复用）
};

export function loadSettings() {
  try {
    return { ...defaults, ...JSON.parse(localStorage.getItem(KEY) || "{}") };
  } catch {
    return { ...defaults };
  }
}

export function saveSettings(s) {
  localStorage.setItem(KEY, JSON.stringify(s));
}

// 仅更新部分字段并持久化
export function patchSettings(patch) {
  const s = loadSettings();
  Object.assign(s, patch);
  saveSettings(s);
  return s;
}
