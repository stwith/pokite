# Website QA

Final result: passed (local browser verification).

- Inspected Rene desktop/mobile references for whitespace, serif hierarchy and
  illustration-led storytelling; created original Pokite illustration and copy.
- Inspected desktop full-page and mobile screenshots. Fixed Chinese hero line
  wrapping so the final word is not split on a 390px viewport.
- Chromium: page renders without JavaScript errors; language toggle and FAQ work.
- WebKit: Chinese and English checked at 320, 390, 768 and 1440px, no horizontal
  overflow. Screenshot reviewed at 390x844.
- CTA links point to the real GitHub setup documentation. Image and CSS paths
  are relative for deployment at /pokite/.
- Semantic headings, native details/summary, focus-visible styles, skip link,
  reduced-motion handling, image descriptions and declared language included.
- No live agent data, access credentials, third-party trackers, external fonts,
  notification claims or copied reference-site images.
- FAQ focuses on shipped capabilities without advertising push. macOS preview and per-provider
  differences remain visible. Phone screenshot is marked as fictional content.

Browser checks do not substitute for user acceptance on physical phones.

## Scene-led editorial version — September 17

- Replaced the hero with a relaxing phone-user illustration and introduced
  coffee and walking scenes, with small illustrative conversations.
- Open Doodles art by Pablo Stanley is locally hosted, recolored and credited
  in assets/ILLUSTRATION-CREDITS.md. The following historical notes describe
  earlier original illustration iterations, not the current third-party assets.
- Removed numbered feature-list presentation; retained all six product benefits.
- Introduced compact floating navigation, soft stipple backdrops and broader
  scene spacing while preserving the real UI demonstration and clear setup CTA.
- Fixed actual tablet/mobile illustration overflow rather than clipping content.
- Chromium and WebKit: both languages at 320/390/768/1440px pass overflow checks;
  scrolling reveals content, FAQ opens, reduced motion leaves all content visible.
- Reviewed full-page screenshots after lazy images loaded. No JavaScript errors.

## Illustration and motion refinement

- Replaced the initial device diagram with an original editorial scene: a seated
  person checking a phone beside a working laptop, with a plant and coffee cup.
- Separate vector layers animate the kite, steam and screen indicator.
- Added progressive scroll reveals, staggered conversation bubbles, subtle mouse
  response on the hero illustration, and FAQ/button interaction feedback.
- Content is visible without JavaScript. Reduced-motion preferences remove
  animation and reveal hiding; primary page animations pause when hidden.
- Chromium and WebKit verification covers scrolling, language switching,
  reduced motion and horizontal overflow at 320, 390, 768 and 1440px.
