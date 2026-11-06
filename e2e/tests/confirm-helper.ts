import type { Page } from '@playwright/test';

/**
 * The studio asks before destructive actions with its own confirm dialog
 * (components/neon/ConfirmDialog.tsx), not window.confirm. Specs that only need to get past it call
 * this once: whenever the dialog shows, its confirm button is pressed before Playwright's next action
 * or assertion. confirm-dialog.spec.ts tests the dialog itself (cancel, Escape, focus).
 */
export async function autoConfirm(page: Page): Promise<void> {
  const dialog = page.getByTestId('confirm-dialog');
  await page.addLocatorHandler(dialog, async (d) => {
    await d.locator('.nx-confirm-actions button').last().click();
  });
}
