import { expect, test } from '@playwright/test'
import { gradientPng } from '../../apps/api/src/common/png'
import { login, uniqueTag } from './helpers'

// The X on uploaded folder cards and photo tiles (event page): confirm, delete, counts follow.

test('X removes a photo (with the picks warning) and a whole folder; counts update; no console errors', async ({ page }, info) => {
  const errors: string[] = []
  const touch = info.project.name === 'mobile'

  await login(page)
  const tag = uniqueTag()
  const sel = await (await page.request.post('/api/v1/selections/details', { data: { customerName: `Mira ${tag}`, customerPhone: '98450 55668', eventName: `Mira ${tag} Wedding`, quota: 5 } })).json()
  const ids: Record<string, string> = {}
  for (const name of ['One Piece', 'Haldi']) {
    const folder = await (await page.request.post(`/api/v1/selections/${sel.id}/folders`, { data: { name } })).json()
    ids[name] = folder.id
    for (let i = 0; i < 2; i++) {
      const r = await page.request.post(`/api/v1/selections/${sel.id}/photos`, {
        multipart: { folderId: folder.id, file: { name: `${name[0]}${i}.png`, mimeType: 'image/png', buffer: Buffer.from(gradientPng(80, 60, 20 + i * 100 + (name === 'Haldi' ? 40 : 0), 210 - i * 60)) } },
      })
      expect(r.ok(), await r.text()).toBe(true)
    }
  }
  // The customer picks one Haldi photo.
  const token = (await (await page.request.post('/api/v1/public/selection/verify', { data: { code: sel.code, shareToken: sel.publicToken } })).json()).token as string
  const photos: { id: string; originalName: string; folderId: string }[] = await (await page.request.get(`/api/v1/selections/${sel.id}/photos`)).json()
  const pickedPhoto = photos.find((p) => p.folderId === ids.Haldi)!
  expect((await page.request.patch(`/api/v1/public/selection/${sel.id}/items/${pickedPhoto.id}`, { data: { selected: true }, headers: { 'X-Client-Token': token } })).ok()).toBe(true)

  // Listen from here: the login page's own signed-in check answers 401 before logging in.
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  page.on('pageerror', (e) => errors.push(e.message))
  await page.goto(`/photo-selection/${sel.id}`)
  const info$ = page.getByTestId('event-info')
  await expect(info$).toContainText('2 Folders')
  await expect(info$).toContainText('4 Images')

  // Folder X: hidden until hover on desktop, always shown on touch.
  const grid = page.getByTestId('folder-grid')
  const folderX = grid.getByRole('button', { name: 'Remove One Piece' })
  if (touch) await expect(folderX).toHaveCSS('opacity', '1')
  else {
    await expect(folderX).toHaveCSS('opacity', '0')
    await grid.getByRole('button', { name: /Open photo folder One Piece/ }).hover()
    await expect(folderX).toHaveCSS('opacity', '1')
  }
  await page.screenshot({ path: `test-results/remove-x-${info.project.name}-folders.png` })

  // A picked photo: the warning and "Delete anyway"; the folder doesn't open.
  await grid.getByRole('button', { name: /Open photo folder Haldi/ }).click()
  await expect(page.getByRole('tab', { name: 'Picked (1)' })).toBeVisible()
  const tiles = page.getByTestId('folder-photos')
  if (!touch) await tiles.locator('.photo-tile').filter({ hasText: pickedPhoto.originalName }).hover()
  await page.screenshot({ path: `test-results/remove-x-${info.project.name}-photos.png` })
  await tiles.getByRole('button', { name: `Remove ${pickedPhoto.originalName}` }).click()
  await expect(page.locator('.lightbox')).toHaveCount(0)
  const dlg = page.getByRole('dialog', { name: 'Delete photo?' })
  await expect(dlg).toContainText(`Delete '${pickedPhoto.originalName}' from this event?`)
  await expect(dlg).toContainText("This photo is in the customer's selection and will be removed from it.")
  await dlg.getByRole('button', { name: 'Delete anyway' }).click()
  await expect(page.getByText('Photo deleted').first()).toBeVisible()
  await expect(page.getByRole('tab', { name: 'Picked (0)' })).toBeVisible()
  await expect(page.getByRole('tab', { name: 'All (1)' })).toBeVisible()
  await expect(info$).toContainText('3 Images')

  // Delete key on a focused photo opens the same confirm; Cancel keeps it.
  await tiles.getByRole('button', { name: /^Open / }).first().focus()
  await page.keyboard.press('Delete')
  await page.getByRole('dialog', { name: 'Delete photo?' }).getByRole('button', { name: 'Cancel' }).click()
  await expect(page.getByRole('tab', { name: 'All (1)' })).toBeVisible()

  // Whole folder from its card.
  await page.getByRole('button', { name: 'All folders' }).click()
  await grid.getByRole('button', { name: 'Remove One Piece' }).click()
  const fdlg = page.getByRole('dialog', { name: 'Delete folder?' })
  await expect(fdlg).toContainText("Delete folder 'One Piece' (2 photos) from this event? Your customer won't see these photos anymore.")
  await fdlg.getByRole('button', { name: 'Delete folder' }).click()
  await expect(page.getByText('Folder deleted').first()).toBeVisible()
  await expect(info$).toContainText('1 Folders')
  await expect(info$).toContainText('1 Images')
  await expect(grid.getByRole('button', { name: /One Piece/ })).toHaveCount(0)

  // The customer no longer sees them; Client Activity has both.
  const after: unknown[] = await (await page.request.get(`/api/v1/selections/${sel.id}/photos`)).json()
  expect(after).toHaveLength(1)
  const overview = await (await page.request.get(`/api/v1/selections/${sel.id}/overview`)).json()
  expect(JSON.stringify(overview)).toContain('Studio removed 2 photos (One Piece)')
  expect(JSON.stringify(overview)).toContain(`Studio removed ${pickedPhoto.originalName}`)

  expect(errors, errors.join(' | ')).toEqual([])
})
