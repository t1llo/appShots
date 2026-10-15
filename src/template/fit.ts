/**
 * The scripts that run in a page before it is captured. Each ends by telling the renderer whether the page is ready:
 * `document.body.dataset.ready` is "1" once it is, or "error" with `dataset.error` saying what is wrong, as
 * "<kind>:<detail>" joined by "; ", such as "screenshot:home missing".
 */

/**
 * What the page reports when it is done: a picture that did not load, and anything that went wrong while fitting.
 * A name nothing was uploaded under is not one of them: the page draws a placeholder for it or leaves it out, and the
 * render warns about it before the page is drawn.
 */
const REPORT = `
  const report = (broken, problems) => {
    for (const img of broken) {
      const name = img.dataset.shot ? 'screenshot:' + img.dataset.shot : 'image:' + (img.dataset.image || img.getAttribute('src'));
      // A picture the server could not find has a failed response; one it sent that the browser cannot read has none.
      const entry = performance.getEntriesByName(img.currentSrc || img.src)[0];
      problems.push(name + (!entry || entry.responseStatus >= 400 ? ' missing' : ' undecodable'));
    }
    if (problems.length) {
      document.body.dataset.error = problems.join('; ');
      document.body.dataset.ready = 'error';
    } else document.body.dataset.ready = '1';
  };
  const decoded = async () => {
    const broken = [];
    await Promise.all([...document.images].map((img) => img.decode().catch(() => broken.push(img))));
    return broken;
  };`;

/**
 * Runs in a slide or a creative: waits for fonts and images, then shrinks badges and copy until they fit.
 *
 * Each size is tried on the same steps a loop walking it down one at a time would take, so the outcome is the same,
 * but by halving: the page is laid out a handful of times instead of once a step.
 */
export const FIT_SCRIPT = `(async () => {${REPORT}
  const canvas = document.querySelector('.canvas');
  const set = (name, value) => canvas.style.setProperty(name, String(value));
  try {
    await Promise.all(JSON.parse(canvas.dataset.fonts).map((font) => document.fonts.load(font)));
    await document.fonts.ready;
  } catch {}
  const broken = await decoded();
  const problems = [];
  // The values a loop stepping a size would give it, from where it starts to the first past its limit.
  const ladder = (start, next, more) => {
    const rungs = [start];
    while (more(rungs[rungs.length - 1])) rungs.push(next(rungs[rungs.length - 1]));
    return rungs;
  };
  // Sets the first rung at which a check passes, or the last rung when none does. A size that passes keeps passing at the rungs after it.
  const first = (rungs, apply, passes) => {
    let lo = 0;
    let hi = rungs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      apply(rungs[mid]);
      if (passes()) hi = mid;
      else lo = mid + 1;
    }
    apply(rungs[lo]);
    return rungs[lo];
  };
  try {
    const u = parseFloat(getComputedStyle(canvas).getPropertyValue('--u'));
    const copy = canvas.querySelector('.copy');
    const stage = canvas.querySelector('.stage');

    const badges = canvas.querySelector('.badges');
    let bs = parseFloat(canvas.style.getPropertyValue('--bs'));
    if (badges) {
      const wrapped = () => {
        const kids = badges.children;
        const last = kids[kids.length - 1];
        return badges.scrollWidth > badges.clientWidth + 1 || (kids.length > 1 && last.offsetTop > kids[0].offsetTop + kids[0].offsetHeight / 2);
      };
      bs = first(ladder(bs, (b) => b - 0.04, (b) => b > 0.5), (b) => set('--bs', b), () => !wrapped());
    }

    if (copy) {
      const headline = copy.querySelector('.headline');
      const max = parseFloat(canvas.dataset.copyMax) * canvas.clientHeight;
      const ts = parseFloat(canvas.style.getPropertyValue('--ts'));
      const floor = ts * 0.5;
      const tooBig = () => copy.offsetHeight > max || (headline && headline.scrollWidth > headline.clientWidth + 1);
      // Where the copy has a fixed box to stay in, the badges shrink in step with the text instead of holding their size.
      const together = badges && canvas.dataset.shrink === 'together';
      const rungs = ladder([ts, bs], ([t, b]) => [t - 0.025, together && b > 0.4 ? b - 0.02 : b], ([t]) => t > floor);
      const apply = ([t, b]) => {
        set('--ts', t);
        if (together) set('--bs', b);
      };
      first(rungs, apply, () => !tooBig());
    }

    const grid = canvas.querySelector('.f-grid');
    if (grid) {
      const tiles = [...grid.querySelectorAll('.f-tile')];
      // A card much wider than it is tall reads better with its icon beside the text.
      for (const tile of tiles) {
        // One that shows a screenshot turns sooner: the picture needs the height more than the text does.
        const turns = tile.classList.contains('pic') ? 1.25 : tile.classList.contains('hero') ? 2.7 : 2.05;
        if (!tile.classList.contains('row') && tile.clientWidth > tile.clientHeight * turns) tile.classList.add('row');
      }
      const fz = parseFloat(grid.style.getPropertyValue('--fz'));
      const spills = () => tiles.some((tile) => tile.scrollHeight > tile.clientHeight + 1 || tile.scrollWidth > tile.clientWidth + 1);
      first(ladder(fz, (f) => f - 0.03, (f) => f > 0.45), (f) => grid.style.setProperty('--fz', String(f)), () => !spills());
    }

    // A stat, a set of steps or a wall of reviews grows into the room the copy leaves, then gives way until it fits.
    for (const box of canvas.querySelectorAll('[data-size]')) {
      const name = box.dataset.size;
      const most = parseFloat(box.dataset.grow);
      const room = () => canvas.clientHeight - (copy ? copy.offsetHeight : 0) - u * 22;
      // The giant figure of a stat is as wide as the slide lets it be, whatever size the lines under it have.
      const figure = box.querySelector('.st-main .st-value');
      const sv = parseFloat(box.style.getPropertyValue('--sv'));
      const hold = () => {
        if (!figure) return;
        const inner = getComputedStyle(box);
        const width = box.clientWidth - parseFloat(inner.paddingLeft) - parseFloat(inner.paddingRight);
        let value = sv;
        box.style.setProperty('--sv', String(value));
        while (figure.scrollWidth > width && value > 4) box.style.setProperty('--sv', String((value -= 0.4)));
      };
      const cramped = () => [...box.querySelectorAll('.st-item .st-value')].some((value) => value.scrollWidth > value.parentElement.clientWidth + 1);
      const spills = () => box.scrollHeight > room() + 1 || box.scrollWidth > box.clientWidth + 1 || cramped();
      const size = parseFloat(box.style.getPropertyValue(name));
      const resize = (s) => box.style.setProperty(name, String(s));
      const grow = (s) => {
        resize(s);
        hold();
      };
      // It grows to the first size that spills, holding the figure in at each, and shrinks from there with the figure as it is.
      const grown = first(ladder(size, (s) => s + 0.03, (s) => s < most), grow, spills);
      first(ladder(grown, (s) => s - 0.03, (s) => s > 0.4), resize, () => !spills());
    }

    if (stage) {
      const style = getComputedStyle(stage);
      const room = stage.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      for (const device of stage.querySelectorAll('.device')) {
        const width = parseFloat(device.style.getPropertyValue('--dw'));
        if (device.dataset.fit === 'contain') {
          const perWidth = device.offsetHeight / width;
          device.style.setProperty('--dw', Math.min(width, room / perWidth) * parseFloat(device.dataset.scale) + 'px');
        } else if (!stage.classList.contains('multi') && room - device.offsetHeight > u * 4) {
          // A device that fits whole would leave a dead band at the edge it was meant to bleed off.
          stage.classList.add('fits');
        } else if (device.classList.contains('mac') && !stage.classList.contains('multi') && !canvas.classList.contains('layout-device-top') && device.offsetHeight - room < device.offsetHeight * 0.16) {
          // A MacBook cut off just above its base looks broken, so one that nearly fits is made to fit whole.
          device.style.setProperty('--dw', (width * (room - u * 5)) / device.offsetHeight + 'px');
          stage.classList.add('fits');
        }
      }
      if (stage.classList.contains('desk')) {
        // A laptop with a phone or a tablet in front of it is shown whole: cut off, the smaller ones would lose their feet.
        const devices = [...stage.querySelectorAll('.device')];
        const top = Math.min(...devices.map((device) => device.offsetTop));
        const tall = Math.max(...devices.map((device) => device.offsetTop + device.offsetHeight)) - top;
        const free = stage.clientHeight - top - u * 5;
        if (tall > free) stage.style.setProperty('--aw', (parseFloat(stage.style.getPropertyValue('--aw')) * free) / tall + 'px');
      }
      if (stage.classList.contains('multi')) {
        // Devices that all end above the bottom edge sit in the middle of the room under the copy, not against it.
        const devices = [...stage.querySelectorAll('.device')];
        const spare = stage.clientHeight - Math.max(...devices.map((device) => device.offsetTop + device.offsetHeight)) - Math.min(...devices.map((device) => device.offsetTop));
        if (spare > u * 4) for (const device of devices) device.style.top = device.offsetTop + spare / 2 + 'px';
      }
    }
  } catch (error) {
    problems.push('fit:' + (error instanceof Error ? error.message : String(error)));
  }
  report(broken, problems);
})();`;

/** Runs in a mockup: waits for the font of the status bar and the screenshot, then says whether the page is ready. */
export const READY_SCRIPT = `(async () => {${REPORT}
  try {
    await document.fonts.load("600 40px 'Inter Variable'");
  } catch {}
  report(await decoded(), []);
})();`;
