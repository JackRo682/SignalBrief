import type {Page} from '@playwright/test';
export async function openPublicMenu(page:Page){
 const toggle=page.locator('.public-info-menu-toggle');
 if(await toggle.isVisible() && await toggle.getAttribute('aria-expanded')!=='true')await toggle.click();
}
