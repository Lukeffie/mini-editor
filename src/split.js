export function setupSplit({ container, editorPane, divider, onRatioChange }) {
  let dragging = false;

  function onMove(e) {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    let ratio = ((e.clientX - rect.left) / rect.width) * 100;
    ratio = Math.min(100, Math.max(0, ratio));
    editorPane.style.flexBasis = ratio + "%";
    onRatioChange(ratio);
  }

  function stop() {
    dragging = false;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
  }

  divider.addEventListener("pointerdown", (e) => {
    e.preventDefault();
    dragging = true;
    divider.setPointerCapture(e.pointerId);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  divider.addEventListener("pointermove", onMove);
  divider.addEventListener("pointerup", stop);
  divider.addEventListener("pointercancel", stop);

  // 双击分隔条在「全屏编辑 / 全屏预览」间快速切换
  divider.addEventListener("dblclick", () => {
    const cur = parseFloat(editorPane.style.flexBasis) || 50;
    onRatioChange(cur > 50 ? 0 : cur < 50 ? 100 : 50);
  });
}
