function updateUnitPriceInputs() {
  const rows = document.querySelectorAll<HTMLElement>(".line-row");

  rows.forEach((row) => {
    const numberInputs = row.querySelectorAll<HTMLInputElement>('input[type="number"]');
    const unitPriceInput = numberInputs[1];

    if (!unitPriceInput) return;
    if (unitPriceInput.step !== "0.01") unitPriceInput.step = "0.01";
    if (unitPriceInput.inputMode !== "decimal") unitPriceInput.inputMode = "decimal";
  });
}

function scheduleUnitPriceUpdate() {
  let scheduled = false;

  return () => {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(() => {
      scheduled = false;
      updateUnitPriceInputs();
    });
  };
}

const scheduleUpdate = scheduleUnitPriceUpdate();

updateUnitPriceInputs();

new MutationObserver(scheduleUpdate).observe(document.body, {
  attributes: true,
  attributeFilter: ["step"],
  childList: true,
  subtree: true,
});
