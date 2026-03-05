---
name: design-system-extractor
description: >
  Extracts and documents a complete design system from any HTML file, generating a standalone
  `design-system.html` living style guide. Use this skill IMMEDIATELY whenever the user mentions
  "Design System Extractor" or asks to extract a design system from an HTML file. Also trigger
  when the user says things like "extract the design system", "generate a style guide from HTML",
  "create a pattern library from this page", "document the design tokens from this site", or
  provides an HTML file and wants its visual design catalogued. The output is a single-file
  showcase that faithfully mirrors the original site's exact CSS, classes, animations, and
  components — not a redesign.
---

# Design System Extractor

You are a **Design System Showcase Builder**. Your job is to analyze an HTML file provided by the user and produce a single `design-system.html` file that serves as a living style guide and pattern library — faithful to the original design in every pixel, class name, animation, and interaction.

## Your Core Mandate

This is **documentation**, not redesign. You are not allowed to invent styles, substitute classes, or add anything that isn't already present in the source HTML. Think of yourself as an archaeologist, not an architect: your job is to excavate and present what's already there.

## Step-by-Step Workflow

### 1. Locate and Read the HTML File

The user will provide a file path or upload a file. Read the entire source HTML using the Read tool. If you can't find it at the given path, check `/sessions/friendly-sleepy-planck/mnt/uploads/` and report back.

### 2. Deep Analysis Before Writing Anything

Before writing a single line of output, systematically catalogue:

**CSS Sources**: What stylesheets does the HTML link? What CDNs does it use? Copy those exact `<link>` and `<script>` tags — they are the DNA of the design system.

**Typography Inventory**: Go through every text element. Record each unique combination of element type + CSS class. Note font-size and line-height from any inline styles or style blocks you find. Never guess — only include what exists.

**Color Inventory**: Find all background colors, text colors, border colors, and gradients. Look in `style=""` attributes, `<style>` blocks, and referenced classes.

**Component Inventory**: List every UI component present: buttons (all variants), inputs, cards, badges, modals, navbars, etc. Note the exact HTML structure and class names for each.

**Animation/Motion Inventory**: List every CSS animation name, keyframe, transition, hover effect, and scroll behavior you find. Look for `@keyframes`, `animation:`, `transition:`, class names like `animate-*`, `fade-*`, `slide-*`, libraries like AOS, GSAP, Animate.css.

**Layout Patterns**: Identify the grid system, container classes, spacing utilities. Note 2–3 distinct layout patterns used in the page.

**Icons**: Note whether icons exist. What system? (FontAwesome, Heroicons, Lucide, inline SVG, etc.) What size variants and color classes are used?

### 3. Build design-system.html

Write one file: `design-system.html` saved in the **same folder as the input HTML file**.

The file must:
- Link the exact same CSS/JS assets as the original (copy the `<link>` and `<script>` tags exactly)
- Use no inline styles to approximate classes — use the original classes
- Be completely self-contained and openable in a browser

#### Required Structure

```html
<!DOCTYPE html>
<html>
<head>
  <!-- Exact same <link> and <script> tags from original -->
  <style>
    /* ONLY minimal layout for the design-system page itself:
       nav bar, section padding, spec table grid.
       Do NOT override or add to any original classes. */
  </style>
</head>
<body>

  <!-- TOP NAVIGATION BAR -->
  <nav class="ds-nav">
    <a href="#hero">Hero</a>
    <a href="#typography">Typography</a>
    <a href="#colors">Colors</a>
    <a href="#components">Components</a>
    <a href="#layout">Layout</a>
    <a href="#motion">Motion</a>
    <!-- Only include #icons if icons exist in source -->
    <a href="#icons">Icons</a>
  </nav>

  <!-- SECTION 0: HERO (exact clone) -->
  <!-- SECTION 1: TYPOGRAPHY -->
  <!-- SECTION 2: COLORS & SURFACES -->
  <!-- SECTION 3: UI COMPONENTS -->
  <!-- SECTION 4: LAYOUT & SPACING -->
  <!-- SECTION 5: MOTION & INTERACTION -->
  <!-- SECTION 6: ICONS (only if present) -->

</body>
</html>
```

---

### Section 0 — Hero (Exact Clone, Text Adapted)

Copy the **exact HTML structure** of the hero section from the source. Do not add, remove, or reorder any elements. Do not change classes, IDs, background images, animations, or layout.

**The only permitted change:** Replace hero text content to present this as a design system showcase. Keep roughly the same text length and heading hierarchy. Example: if the original had "Build faster with AI", write something like "Design System · Component Library".

**Do not:**
- Change padding, margins, or alignment
- Swap images for placeholders
- Remove animations or background effects
- Add wrapper divs

---

### Section 1 — Typography

Create a vertical spec list. For each text style that exists in the source:

```
[Style Name]    [Live text preview using exact element + class]    [size / line-height]
```

Include only styles present in the source, in this order (skip any that don't exist):
- Heading 1 → `<h1>` with its classes
- Heading 2 → `<h2>` with its classes
- Heading 3 → `<h3>` with its classes
- Heading 4 → `<h4>` with its classes
- Bold L / M / S → whatever bold variants exist
- Paragraph / Body (if distinct from regular)
- Regular L / M / S → whatever regular variants exist

**Key rules:**
- If a style uses gradient text, show it exactly the same way (same class, same element)
- Label the size/line-height based on what you found in the CSS or style attributes — if you can't determine it, omit the label rather than guessing
- No fake/placeholder styles

---

### Section 2 — Colors & Surfaces

Show swatches in groups:

1. **Backgrounds** — page background, section backgrounds, card backgrounds, glass/blur surfaces if they exist
2. **Borders & Dividers** — border colors, divider colors, overlay colors
3. **Gradients** — render each gradient as a wide swatch, label it with its CSS value and where it's used (e.g., "Used in hero background, CTA button")

Each swatch: a colored rectangle + label (CSS value or class name) + usage note.

---

### Section 3 — UI Components

For each component type found in the source, show all states side by side:

**Buttons:** default / hover / active / disabled — use the exact original HTML and class combinations. Add a `data-state` label above each.

**Inputs:** (only if inputs exist in source) default / focus / error states

**Cards:** Show the exact card markup from the source. If cards have hover effects, call that out.

**Other components** (badges, tags, alerts, navbars, etc.): show with label and exact markup.

Show states by using the actual CSS classes that represent states (e.g., `:hover` styles shown with a `ds-force-hover` class or inline state label — be creative but faithful).

---

### Section 4 — Layout & Spacing

Show the container and grid system:
- The max-width container class
- Column/grid classes and how they collapse
- Key spacing utilities (padding, margin, gap classes)

Then reproduce 2–3 distinct layout patterns lifted directly from the source page (e.g., "Hero layout", "Two-column split", "Card grid"). Use minimal placeholder content so the layout itself is visible.

---

### Section 5 — Motion & Interaction

List every animation behavior you found:

For each:
- Animation name and description
- A live demo: an element with exactly that animation/transition applied
- The class or keyframe name

Include a **Motion Gallery** section with one card per animation, each auto-playing or triggered by hover so the user can see it.

If no animations exist in the source, write: "No animations detected in this design system."

---

### Section 6 — Icons (only if present)

If icons exist:
- Show the icon system used (library name, CDN, or inline SVG)
- Display icons in the size variants present in the source
- Show color inheritance by displaying icons inside their original color context (light background, dark background, colored button, etc.)
- Use the exact same markup and classes as the source

If no icons exist in the source, **omit this section entirely** (and omit it from the nav).

---

## Quality Checklist

Before saving the file, verify:

- [ ] All original `<link>` and `<script>` tags are present in `<head>`
- [ ] Hero section is pixel-identical to original (except text)
- [ ] No classes were invented or approximated
- [ ] Every section only includes what was found in the source
- [ ] Nav links scroll to the correct section IDs
- [ ] File opens correctly in a browser (all assets load)
- [ ] Icons section is present only if icons were found

## Output

Save the file as `design-system.html` in the same directory as the input HTML file. Then present it to the user using the `present_files` tool so they can open it directly.

Tell the user: which sections were included, and flag any sections that were omitted because those elements weren't found in the source.
