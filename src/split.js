export function setupSplit({ container, editorPane, divider, onRatioChange }) {
  let dragging = false;

  divider.addEventListener("mousedown", (e) => {
    dragging = true;
    document.body.style.cursor = "col-resize";
    e.preventDefault();
  });

  window.addEventListener("mousemove", (e) => {
    if (!dragging) return;
    const rect = container.getBoundingClientRect();
    let ratio = ((e.clientX - rect.left) / rect.width) * 100;
    ratio = Math.min(80, Math.max(20, ratio));
    editorPane.style.flexBasis = ratio + "%";
    onRatioChange(ratio);
  });

  window.addEventListener("mouseup", () => {
    dragging = false;
    document.body.style.cursor = "";
  });
}
