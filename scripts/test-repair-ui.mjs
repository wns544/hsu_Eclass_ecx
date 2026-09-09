// UI-only checks with fake file handles: never opens or overwrites user files.
// Set PLAYWRIGHT_MODULE to an installed playwright package and CHROME_PATH if needed.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'esbuild';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const bundle = await build({
    stdin: {
        contents: 'import { createRepairSection } from "./src/direct_downloads/repair.ts"; document.body.append(createRepairSection());',
        resolveDir: process.cwd(),
    },
    bundle: true, write: false, platform: 'browser',
    plugins: [{
        name: 'fake-normalizer',
        setup(builder) {
            builder.onResolve({ filter: /mp4-normalize$/ }, () => ({ path: 'mock', namespace: 'fixture' }));
            builder.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `
                export async function normalizeToMp4(file, name, onProgress, onStage) {
                    onStage('analyzing');
                    await new Promise(resolve => window.releaseRead = resolve);
                    onStage('converting'); onProgress(42);
                    await new Promise(resolve => window.releaseConversion = resolve);
                    onStage('verifying');
                    return { file: new File(['verified-test-output'], name), inputFormat: 'MPEG-TS', duration: 100 };
                }
            ` }));
        },
    }],
});
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_PATH || undefined });
try {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html lang="ko"><meta charset="utf-8"><body style="max-width:1000px;margin:24px auto;padding:0 16px;box-sizing:border-box"></body></html>');
    await page.addStyleTag({ content: await readFile('dist/direct_downloads/index.css', 'utf8') });
    await page.evaluate(() => {
        window.saved = []; window.aborted = []; window.failWrites = false;
        const names = ['01주차_OT 동영상.mp4', '읽기 실패 영상.mp4', '2과_문법 — 긴 제목과 Google Drive 마운트 폴더 영상.mp4'];
        window.showOpenFilePicker = async function () {
            if (window.cancelPicker) throw new DOMException('Canceled', 'AbortError');
            return names.map((name, index) => ({
                name,
                getFile: async () => {
                    if (index === 1) throw new Error('마운트 폴더의 파일을 읽을 수 없습니다.');
                    return new File(['fixture'], name);
                },
                createWritable: async () => ({
                    write: async () => {
                        if (window.failWrites) throw new Error('쓰기 실패');
                    },
                    close: async () => window.saved.push(name),
                    abort: async () => window.aborted.push(name),
                }),
            }));
        };
    });
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole('button', { name: '+ 영상 선택 후 복구', exact: true }).click();
    await page.waitForFunction(() => window.releaseRead);
    assert.equal(await page.locator('.ecx-repair-card').count(), 3);
    assert.equal(await page.locator('[data-phase="queued"]').count(), 2);
    assert.equal(await page.locator('.ecx-repair-card').first().locator('progress').getAttribute('value'), null);
    await page.screenshot({ path: 'dist/repair-ui-reading.png', fullPage: true });
    await page.evaluate(() => { window.releaseRead(); window.releaseRead = null; });
    await page.waitForFunction(() => window.releaseConversion);
    assert.equal(await page.locator('.ecx-repair-progress-text').first().textContent(), '정리 42%');
    await page.screenshot({ path: 'dist/repair-ui-progress.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 1000 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: 'dist/repair-ui-mobile.png', fullPage: true });
    await page.setViewportSize({ width: 1080, height: 1100 });
    await page.evaluate(() => { window.releaseConversion(); window.releaseConversion = null; });
    await page.waitForFunction(() => window.releaseRead);
    assert.equal(await page.locator('[data-phase="completed"]').count(), 1);
    assert.equal(await page.locator('[data-phase="failed"]').count(), 1);
    await page.evaluate(() => { window.releaseRead(); window.releaseRead = null; });
    await page.waitForFunction(() => window.releaseConversion);
    await page.evaluate(() => { window.releaseConversion(); window.releaseConversion = null; });
    await page.waitForFunction(() => !document.querySelector('.ecx-repair-select').disabled);
    assert.match(await page.getByRole('status').textContent(), /완료 2개 · 실패 1개/);
    assert.equal(await page.evaluate(() => window.saved.length), 2);
    await page.screenshot({ path: 'dist/repair-ui-results.png', fullPage: true });

    // Picker cancellation keeps the previous batch visible.
    await page.evaluate(() => window.cancelPicker = true);
    await page.locator('.ecx-repair-select').click();
    await page.waitForFunction(() => !document.querySelector('.ecx-repair-select').disabled);
    assert.equal(await page.locator('.ecx-repair-card').count(), 3);

    // Stop after the active file; failed writes are aborted, queued files untouched.
    await page.evaluate(() => { window.cancelPicker = false; window.failWrites = true; });
    await page.locator('.ecx-repair-select').click();
    await page.waitForFunction(() => window.releaseRead);
    await page.locator('.ecx-repair-stop').click();
    await page.evaluate(() => { window.releaseRead(); window.releaseRead = null; });
    await page.waitForFunction(() => window.releaseConversion);
    await page.evaluate(() => { window.releaseConversion(); window.releaseConversion = null; });
    await page.waitForFunction(() => !document.querySelector('.ecx-repair-select').disabled);
    assert.equal(await page.locator('[data-phase="skipped"]').count(), 2);
    assert.equal(await page.evaluate(() => window.aborted.length), 1);
    assert.equal(await page.evaluate(() => window.saved.length), 2);
    assert.deepEqual(errors, []);
    console.log('PASS: batch cards, unknown/read progress, conversion percentage, read failure continuation, narrow layout, picker cancellation, stop queue, write abort.');
    console.log('Screenshots:', resolve('dist/repair-ui-progress.png'), resolve('dist/repair-ui-results.png'));
} finally {
    await browser.close();
}
