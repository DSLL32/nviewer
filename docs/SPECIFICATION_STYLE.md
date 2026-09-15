# ROM specification style guide

This is the required structure and notation for game specifications published
with nviewer. The audience is ROM hackers and emulator, decompilation, and tool
developers. Write as a technical manual: state the format and its constraints
directly, retain the evidence for claims, and omit the chronology of the
investigation.

## Document scope

- Write one specification per released game. Keep regional revisions, version
  revisions, debug builds, and content variants of that game together.
- Give a substantially different prototype its own companion specification.
- Make each specification self-contained. Repeating a short shared codec or
  record definition is preferable to requiring a second game manual.
- Do not publish scratch paths, emulator cleanup logs, agent activity, commands
  used only during research, or statements about whether the viewer was changed.
- State facts as facts only when verified. Introduce homogeneous material with
  `Verified from ROM bytes`, `Verified by disassembly`, `Verified against RAM`,
  or similarly explicit wording. Add an `Evidence` column when rows have mixed
  provenance. Label inferences **Hypothesis**.
- Use **Documentation**, **Decompilation**, or **Source archive** for claims
  taken from those sources. Do not use opaque evidence abbreviations such as
  `ROM bytes` or `deterministic decoding`.

## Required hierarchy

Every manual uses these top-level sections. Retain an inapplicable subsection
with a short explanation when its absence is useful information.

```text
# <Game> — Nintendo 64 ROM format specification

## 1. Overview
### 1.1 Technical summary
### 1.2 ROM identification
### 1.3 Terminology and conventions

## 2. Program and storage architecture
### 2.1 Boot and executable layout
### 2.2 Memory and address mapping
### 2.3 ROM map and asset organization
### 2.4 Compression formats
### 2.5 Loading process
### 2.6 Revision differences

## 3. Level data
### 3.1 Level catalog and identifiers
### 3.2 Level container
### 3.3 Geometry
### 3.4 Display lists and render state
### 3.5 Textures and materials
### 3.6 Collision
### 3.7 Environment, sky, fog, and lighting
### 3.8 Cameras and paths

## 4. Objects
### 4.1 Placement records
### 4.2 Object and model formats
### 4.3 Skeletons and animation
### 4.4 Behaviors, triggers, and scripted objects

## 5. Audio
### 5.1 Audio storage and banks
### 5.2 Sequence format and driver
### 5.3 Instruments and sample encoding
### 5.4 Music catalog and loop points

## 6. Unused and hidden content
### 6.1 Unreferenced assets
### 6.2 Cut or inaccessible levels
### 6.3 Debug features
### 6.4 Prototype or revision-specific content

## 7. nviewer implementation
### 7.1 Module mapping
### 7.2 Supported features
### 7.3 Approximations and omissions

## 8. Verification and remaining work
### 8.1 Verification evidence
### 8.2 Known unknowns
### 8.3 References
```

Additional subsections are allowed below the appropriate parent. Put very long
level catalogs, song catalogs, opcode lists, and revision matrices in appendices
when that keeps the main format description easier to follow.

Do not repeat a parent heading as its only child. For example, put the content
directly under `### 5.2 Sequence format and driver` instead of adding
`#### Music` or `#### Sequence format`. Do not carry a former section name into
every child (`#### Music: Driver`, `#### Music: Song list`); use the distinguishing
terms (`#### Driver`, `#### Song list`).

## Overview tables

`1.1 Technical summary` begins with a two-column table. Use these properties in
this order, omitting only genuinely inapplicable rows:

| Property | Value |
|---|---|
| Asset organization | Archive, DMA table, fixed offsets, or other indexing system |
| Compression | Algorithms and the resources to which they apply |
| Graphics microcode | Exact family and version |
| Geometry | Principal scene and model representations |
| Textures | N64 formats and custom codecs |
| Collision | Storage or derivation, primitive type, and important flags |
| Music driver | Sequence player or custom engine |
| Audio microcode | ABI version or custom task |
| Sample encoding | VADPCM, PCM, or custom encoding |
| Levels | Count and definition of a level |
| Memory requirement | Base 4 MiB or Expansion Pak |
| Viewer support | Releases and important limitations |

Do not include byte order. N64 CPU data is big-endian; local exceptions belong
beside the affected format.

Each summary row answers only its named property. In particular, distinguish the
software sequence or sample driver, the RSP audio microcode, and the stored
sample encoding. Do not copy the same combined audio description into two rows.

`1.2 ROM identification` begins with one row per known image:

| Release | NAME | Game code | Revision | Size | CRC1 | CRC2 | SHA-1 | CIC | Build |
|---|---|---|---:|---:|---|---|---|---|---|

- `NAME` is the exact 20-byte N64 header name with trailing padding omitted.
- CRC1 and CRC2 are eight uppercase hexadecimal digits without an implicit
  decimal interpretation.
- SHA-1 is 40 lowercase hexadecimal digits calculated over normalized `.z64`
  bytes. Do not put MD5 in the identification table.
- Use binary KiB and MiB and include a hexadecimal byte size when useful.
- Use `—` for a value that is absent and **Unknown** for a value that has not
  been established. Do not silently omit a required column.

## Binary structure notation

Use an eight-column byte layout for compact fixed-size records. Raw HTML is
intentional because Markdown tables cannot merge cells.

```html
<table class="byte-layout">
  <thead>
    <tr><th>Offset</th><th>+0</th><th>+1</th><th>+2</th><th>+3</th><th>+4</th><th>+5</th><th>+6</th><th>+7</th></tr>
  </thead>
  <tbody>
    <tr>
      <th><code>0x00</code></th>
      <td colspan="4"><code>vromStart: u32</code></td>
      <td colspan="4"><code>vromEnd: u32</code></td>
    </tr>
    <tr>
      <th><code>0x08</code></th>
      <td colspan="4"><code>romStart: u32</code></td>
      <td colspan="4"><code>romEnd: u32</code></td>
    </tr>
  </tbody>
</table>
```

Follow the layout with a semantic table when field names alone are insufficient:

| Field | Description |
|---|---|
| `vromStart` | Inclusive virtual-ROM start address. |
| `vromEnd` | Exclusive virtual-ROM end address. |

Use the conventional form below for variable-length, conditional,
revision-dependent, large, or awkwardly unaligned structures:

| Offset | Size | Type | Field | Description |
|---:|---:|---|---|---|

Give each stored field its own row. Do not compress an entire multi-field
structure into one `Layout` or `Contents` cell; if a summary table refers to a
record, name it there and provide its field table immediately below or at a
clear cross-reference.

Do not present binary structures as fenced code, C declarations, offset lists,
or prose-only field sequences. A grammar, formula, or source excerpt may remain
in a code block only when it is not serving as the structure definition. The
specification checker rejects fenced and inline prose layouts, unnamed fields,
and placeholder-only rows masquerading as format tables.

Other standard forms are:

- bitfields: `Bits | Mask | Name | Meaning`;
- enumerations: `Value | Name | Meaning`;
- ROM maps: `ROM range | Stored size | Decoded size | Destination | Compression | Contents`;
- opcodes: `Opcode | Length | Operands | Effect`;
- addresses: `Purpose | ROM | VRAM | Evidence`;
- revision comparisons: `Feature | <release> | <release>`.

## Numeric and naming conventions

- ROM and memory ranges are half-open: `[start, end)`.
- Offsets, addresses, masks, opcodes, and encoded sizes are hexadecimal unless
  explicitly stated otherwise.
- Use `KiB` and `MiB` for binary quantities.
- Multi-byte fields are big-endian unless the local format says otherwise.
- Use `u8`, `s8`, `u16`, `s16`, `u32`, `s32`, `u64`, `s64`, and `f32`.
- Every structure states its total size or stride, alignment, termination rule,
  pointer domain, and array count where applicable.
- Name unknown fields by offset, such as `unknown_0C`. Label inferred semantics.
- Prefer descriptive links and heading names to bare references such as `section
  5.3`, which become stale when the manual changes.

## Publication checks

Run `npm run check:specs` and `npm run docs:build`. The checker enforces the
required hierarchy and identification columns and rejects published research
process notes and opaque evidence labels.
