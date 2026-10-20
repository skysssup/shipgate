import type { Page } from '@playwright/test';

/**
 * WCAG contrast ratio of every visible text node against its composited background.
 * Shared by the simulator and console specs.
 */
export function contrastRatios(page: Page): Promise<Array<{ text: string; ratio: number }>> {
  return page.evaluate(() => {
    const parse = (c: string): number[] => {
      const numbers = (c.match(/[\d.]+/g) ?? []).map(Number);
      return c.startsWith('color(srgb') ? [...numbers.slice(0, 3).map((n) => n * 255), numbers[3] ?? 1] : numbers;
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const background = (el: Element): number[] => {
      const layers: number[][] = [];
      for (let node: Element | null = el; node; node = node.parentElement) {
        const c = parse(getComputedStyle(node).backgroundColor);
        if (c.length >= 3 && (c[3] ?? 1) > 0) layers.unshift(c);
        if (c.length >= 3 && (c[3] ?? 1) === 1) break;
      }
      let out = [255, 255, 255];
      for (const [r, g, b, a = 1] of layers) out = [r * a + out[0] * (1 - a), g * a + out[1] * (1 - a), b * a + out[2] * (1 - a)];
      return out;
    };
    const texts: Element[] = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !node.textContent?.trim() || texts.includes(parent)) continue;
      const style = getComputedStyle(parent);
      const box = parent.getBoundingClientRect();
      if (style.visibility === 'hidden' || box.width <= 1 || box.height <= 1 || parent.closest('[aria-hidden="true"], .sr-only, .cm-placeholder')) continue;
      texts.push(parent);
    }
    return texts.map((el) => {
      const fg = parse(getComputedStyle(el).color);
      const bg = background(el);
      const [l1, l2] = [lum(fg), lum(bg)].sort((a, b) => b - a);
      return { text: (el.textContent ?? '').trim().slice(0, 40), ratio: (l1 + 0.05) / (l2 + 0.05) };
    });
  });
}
