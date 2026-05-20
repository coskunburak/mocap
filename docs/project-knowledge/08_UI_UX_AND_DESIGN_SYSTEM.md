# 08_UI_UX_AND_DESIGN_SYSTEM

## Visual Style

The app uses a dark, technical, production-tool aesthetic. The interface emphasizes camera preview, motion playback, quality/status indicators, compact controls, and dark glass-like panels.

Primary style characteristics:

- Black/deep background surfaces.
- Cyan/teal accent color.
- White/blue-gray text hierarchy.
- Compact cards and pills.
- Rounded pill controls for tabs and capture controls.
- Large full-screen capture and playback experiences.
- Professional mocap/production vocabulary such as capture, review, export, pipeline, quality, solve.

## Design System Structure

| Area | File | Notes |
| --- | --- | --- |
| Colors | `src/ui/theme/colors.ts` | Dark palette, accent/status colors, gradients |
| Typography | `src/ui/theme/typography.ts` | Platform-specific display/body/mono families |
| Spacing/radii/shadows | `src/ui/theme/spacing.ts` | Spacing scale, radii, common shadows |
| Exports | `src/ui/theme/index.ts` | Theme barrel |
| Components | `src/ui/components/` | `Button`, `Card`, `Screen`, `Modal` |

## Colors

Key colors from `colors.ts`:

| Token | Purpose |
| --- | --- |
| `background`, `backgroundDeep`, `backgroundMuted` | App/page foundations |
| `surface`, `surfaceRaised`, `surfaceStrong`, `surfaceGlass` | Panels and cards |
| `border`, `borderStrong`, `borderAccent`, `line` | Dividers and outlines |
| `textPrimary`, `textSecondary`, `textMuted` | Text hierarchy |
| `accent`, `accentStrong`, `accentSoft` | Primary action and mocap status accent |
| `info`, `warning`, `danger`, `success` | Status semantics |
| `tabBar`, `input` | Navigation and form surfaces |

Dark mode:

- `app.json` sets `userInterfaceStyle` to `dark`.
- Navigation theme in `RootNavigator.tsx` is explicitly dark.
- No light theme implementation was found.

## Typography

Defined in `typography.ts`.

| Group | Usage |
| --- | --- |
| `eyebrow.sm` | Uppercase section labels |
| `title.hero`, `title.screen`, `title.card` | Hero/screen/card headings |
| `body.lg`, `body.md`, `body.sm` | Body and explanatory text |
| `label.lg`, `label.md`, `label.sm` | Buttons, badges, compact labels |
| `mono.sm` | IDs, paths, technical metadata |

Platform font choices:

- iOS display/body: Avenir variants.
- Android display/body: sans-serif condensed/medium.
- Mono: Menlo/monospace fallback.

## Spacing And Shape

Defined in `spacing.ts`.

| Token group | Notes |
| --- | --- |
| `spacing` | 4 to 40 px scale |
| `radii` | 12/18/24/30 and `pill` |
| `layout` | screen padding and section gap |
| `shadows` | soft/panel/glow |

Many feature screens use local styles with 8 px cards in list rows and larger pill controls in camera/player UIs.

## Reusable Components

| Component | File | Purpose |
| --- | --- | --- |
| `Button` | `src/ui/components/Button.tsx` | Primary/secondary/ghost/danger buttons with sizes/loading/full-width |
| `Card` | `src/ui/components/Card.tsx` | Reusable panel/card with tone/padding |
| `Screen`, `ScreenHeader` | `src/ui/components/Screen.tsx` | Scroll/non-scroll screen layout and header pattern |
| `Modal` | `src/ui/components/Modal.tsx` | Shared modal shell |
| `ProjectCard` | `src/features/projects/components/ProjectCard.tsx` | Project summary card |
| `TakeRow` | `src/features/projects/components/TakeRow.tsx` | Shared take row with actions/status |
| `OverlaySkeleton` | `src/features/capture/components/OverlaySkeleton.tsx` | 2D SVG pose/face/hand overlay |
| `LiveAvatarViewer` | `src/features/capture/components/LiveAvatarViewer.tsx` | 3D robot/avatar preview |

## Main Screens

| Screen | File path | Purpose | State source | Known UX risks |
| --- | --- | --- | --- | --- |
| Capture | `src/features/capture/screens/CaptureScreen.tsx` | Full-screen live camera, skeleton overlay, avatar, countdown, recording, nav sheet | `captureStore`, `multiViewStore`, `useWhamCapture` | Dense overlay stack can collide on small screens; front/back UI may not map to native recording camera |
| Multi-view setup | `src/features/capture/screens/MultiViewSetupScreen.tsx` | Dual host/guest or Pro 4 backend setup | `multiViewStore`, `useMultiViewCapture`, backend container | Pro 4 setup is partial; join tokens and LAN IP entry require operator understanding |
| Projects list | `src/features/projects/screens/ProjectsListScreen.tsx` | Group local takes by project id and show recent takes | `takeRepoFs` | Local-only grouping may differ from backend projects |
| Project detail | `src/features/projects/screens/ProjectDetailScreen.tsx` | Show takes in one project group | `takeRepoFs` | No reassignment UI found |
| Review hub | `src/features/review/screens/ReviewHubScreen.tsx` | Queue takes by review status | `takeRepoFs` | Review sort is local-only |
| Motion preview | `src/features/review/screens/MotionPreviewScreen.tsx` | Full-screen avatar playback, gallery, timeline, process/export action | `readTakeMeta`, `readTakeFrames`, `analyzeTakeReview` | Large takes can be memory-heavy; local analysis may differ from backend |
| Take review | `src/features/review/screens/TakeReviewScreen.tsx` | Raw/cleaned review, trim, note, approve/export | `takeRepoFs`, `TakeReviewAnalyzer` | Manual trim UI relies on touch timeline precision |
| Upload progress | `src/features/upload/screens/UploadProgressScreen.tsx` | Auto-start signed upload and show stages | `SignedUrlUploadManager`, local take | Upload auto-start may surprise users; signed URL/network failures need clear recovery |
| Processing status | `src/features/upload/screens/ProcessingStatusScreen.tsx` | Poll job state, show pipeline, retry/cancel | Backend API, local `take.remote` mirror | Polling every 2.5s; stale local state possible |
| Exports list | `src/features/exports/screens/ExportsListScreen.tsx` | Local take export queue and backend handoff actions | `takeRepoFs`, `useExportTake` | Delete action is destructive; local debug export should stay gated |
| Local export | `src/features/exports/screens/ExportScreen.tsx` | Generate local debug/reference export files | `TakeExporter` | Not production source of truth |
| Export result | `src/features/exports/screens/ExportResultScreen.tsx` | Show backend artifacts, reports, overlay video, reprocess presets | Backend export API | Duplicated artifact schemas can drift |

## Navigation Patterns

- Bottom tab navigator for primary areas.
- Capture hides tab bar for full-screen capture.
- Stack navigator overlays secondary workflows.
- Capture screen has its own nav sheet for Review, Projects, Exports, Dual setup.
- Motion preview has gallery/player modes and full-screen bottom controls.

## Empty, Loading, And Error States

Implemented examples:

- Activity indicators for project/review/export loading.
- Empty cards for no takes/projects/exports.
- Upload failed recovery card with retry.
- Processing failed/canceled recovery card with retry.
- ErrorBoundary fallback with reset button.
- Camera permission fallback with settings link.

Risks:

- Some runtime errors still rely on `Alert.alert`.
- Network/offline states are not globally standardized.
- No crash reporting integration is confirmed.

## Accessibility

Confirmed support:

- Some capture/player controls set `accessibilityRole` and `accessibilityLabel`.
- Buttons are text-based and generally clear.

Not confirmed:

- Full VoiceOver/TalkBack audit.
- Dynamic type behavior.
- Contrast audit.
- Focus order testing.

## Localization

Not confirmed as a formal localization system.

Evidence:

- UI strings are hardcoded in English and some Turkish error strings.
- No i18n framework or resource file system was found.

## Animation And Gesture Patterns

- React Navigation transitions.
- Full-screen timeline press interactions.
- Capture countdown.
- Three.js `useFrame` drives avatar animation.
- No broad gesture system beyond gesture handler provider was confirmed.

## Design Risks Future Agents Should Watch

- Do not turn production tool screens into marketing/landing pages.
- Capture and motion preview should stay full-screen and inspection-first.
- Avoid adding large explanatory copy inside workflow screens.
- Keep IDs, job status, artifact names, and technical metadata readable but compact.
- Maintain dark theme consistency unless adding a full light theme intentionally.
