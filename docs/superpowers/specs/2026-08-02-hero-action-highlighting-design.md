# Hero Action Highlighting Design

## Goal

Make every hero-authored action immediately recognizable in both the manual street action editors and the screenshot-import decision list, without making the rows look like primary buttons or reducing readability.

## Visual treatment

- Hero rows use a restrained emerald/felt-green surface, a brighter green border, and a narrow left inset accent.
- Manual action rows also show a compact `HERO` badge so meaning is not conveyed by color alone.
- Villain rows retain the existing neutral surface.
- Existing gold remains reserved for primary actions, selected state, and poker-coach emphasis.
- The treatment uses the existing radius and spacing scale and remains legible at mobile breakpoints.

## Behavior

- A manual action row is a hero row when its actor matches the current `Hero position` value.
- Highlighting updates immediately after adding a row, changing a row actor, or changing the hero position.
- Imported decision cells use the hero treatment for both `First Hero Decision` and `Review Hero Action`; villain key-action cells remain neutral.
- No poker calculations, action ordering, imports, or analysis behavior changes.

## Implementation boundary

- `public/app.js` owns assignment and refresh of the semantic hero-row class.
- `public/styles.css` owns the shared visual treatment for manual and imported hero rows.
- A focused DOM regression test verifies classification changes when actor or hero position changes and verifies imported hero decision kinds receive a hero class.

## Verification

- Run the focused regression test and the full project check.
- Render a hand containing hero and villain actions across streets and confirm only hero rows receive the treatment.
- Confirm actor and hero-position changes update highlighting without a page reload.
- Restart the local server and verify HTTP 200 at `http://localhost:4175`.
