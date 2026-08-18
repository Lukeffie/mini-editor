const KEY = "mini-editor-settings";
const defaults = {
  ratio: 50,
  style: "minimal", // 视觉风格：minimal / mint / vibrant / cyber / classic / ink
  dark: false,      // 是否深色模式（与风格独立）
  fontSize: 14,
  autoSave: false,
  lastDir: null, // 上次打开的目录
};

// 兼容旧版仅含 theme(light/dark) 的设置
function migrate(s) {
  if (s && s.theme && !s.style) {
    s.style = "minimal";
    s.dark = s.theme === "dark";
    delete s.theme;
  }
  return s;
}

export function loadSettings() {
  try {
    return { ...defaults, ...migrate(JSON.parse(localStorage.getItem(KEY) || "{}")) };
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
