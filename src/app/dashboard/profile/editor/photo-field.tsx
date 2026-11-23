'use client';

/**
 * KAN-487 — v0.8 profile editor, §01 "Profile photo" (spec v0.8 §01 "JPG,
 * PNG or WebP; maximum 5 MB; square crop; minimum 400 × 400 pixels"; spec
 * §1 "require explicit confirmation for removing a profile photo"; plan §B
 * "Photo", §C row 01, §D copy — not in the spec, founder-approved 2026-11-23).
 *
 *   1. Pick: `<input type="file" accept="image/jpeg,image/png,image/webp">`.
 *      Type/size are pre-checked, then the image is decoded for the ≥ 400 px
 *      check (the server re-checks everything from the bytes).
 *   2. Crop: a square frame over the image, in natural pixels
 *      (photo-crop.ts). No drag: arrow keys move it, + / − resize it
 *      (Shift = bigger steps); a click on the image centres it there; the
 *      + / − buttons resize it for pointer users.
 *   3. Use this photo: a file over 4 MB is drawn to a canvas (crop square
 *      only, ≤ 2048 px, ≥ 400 px) and re-encoded as JPEG so the request stays
 *      under Vercel's body cap; then `stageProfilePhoto` uploads it to a
 *      unique staged path and the state becomes `{kind:'staged'}`. Nothing
 *      is live until Save Draft / Save Changes.
 *   4. Remove photo → ConfirmDialog → `requestPhotoRemoval`. On a published
 *      profile the blocking note is shown (Save Changes is refused without a
 *      photo — founder decision on the spec's open question).
 */

import { useEffect, useRef, useState } from 'react';
import {
  PHOTO_ACCEPT,
  PHOTO_HINT,
  PHOTO_PUBLISHED_BLOCK_NOTE,
  PHOTO_SIZE_ERROR,
  PHOTO_UNREADABLE_ERROR,
  DOWNSCALE_JPEG_QUALITY,
  applyCropKey,
  centreCropAt,
  checkPhotoDimensions,
  cropOverlayPercent,
  cropStep,
  displayToNatural,
  downscaleSide,
  downscaledUploadCrop,
  initialCrop,
  needsDownscale,
  preCheckPhotoFile,
  resizeCrop,
  safeObjectUrl,
  type CropBox,
} from '@/modules/profile/editor/photo-crop';
import { PUBLISHED_PHOTO_ERROR } from '@/modules/profile/editor/validate-save-payload';
import { describedBy } from '@/modules/profile/editor/editor-ui-helpers';
import { stageProfilePhoto } from '../editor-actions';
import { ConfirmDialog } from './confirm-dialog';
import type { EditorAction, PhotoState } from './editor-context';
import { ERROR_CLASS, HELPER_CLASS, LABEL_CLASS } from './text-field';

export const PHOTO_INPUT_ID = 'profile-photo';
const PREVIEW_BOX = 96;

const FOCUS =
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-2';
const PRIMARY_BUTTON = `px-4 py-2 rounded-lg bg-[var(--color-sage)] text-white text-sm font-medium hover:bg-[var(--color-sage-hover)] disabled:opacity-50 transition-colors ${FOCUS}`;
const SECONDARY_BUTTON = `px-4 py-2 rounded-lg bg-[#f4efe7] text-sm font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-50 transition-colors ${FOCUS}`;
const ICON_BUTTON = `w-9 h-9 rounded-lg bg-[#f4efe7] text-base font-medium text-[var(--color-ink)] hover:bg-[#ece7df] disabled:opacity-50 transition-colors ${FOCUS}`;

export interface PhotoFieldProps {
  photo: PhotoState;
  isPublished: boolean;
  dispatch: (a: EditorAction) => void;
  /** `errors.photo` from the validator or the server. */
  error?: string;
  readOnly?: boolean;
}

interface Pending {
  file: File;
  url: string;
  img: HTMLImageElement;
  width: number;
  height: number;
}

function photoUrl(photo: PhotoState): string | null {
  if (photo.kind === 'stored') return photo.url;
  if (photo.kind === 'staged') return photo.previewUrl;
  return null;
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function canvasCrop(img: HTMLImageElement, crop: CropBox, side: number): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = side;
  canvas.height = side;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  // Transparent PNG/WebP areas become white, as on the server.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, side, side);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, crop.x, crop.y, crop.size, crop.size, 0, 0, side, side);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/jpeg', DOWNSCALE_JPEG_QUALITY));
}

/** The file + crop to send: the original when small enough, else a downscaled crop. */
async function prepareUpload(p: Pending, crop: CropBox): Promise<{ file: File; crop: CropBox } | { error: string }> {
  if (!needsDownscale(p.file.size)) return { file: p.file, crop };
  for (let attempt = 0; ; attempt += 1) {
    const side = downscaleSide(crop.size, attempt);
    if (side === null) return { error: PHOTO_SIZE_ERROR };
    const blob = await canvasCrop(p.img, crop, side);
    if (!blob) return { error: PHOTO_UNREADABLE_ERROR };
    if (!needsDownscale(blob.size)) {
      return { file: new File([blob], 'avatar.jpg', { type: 'image/jpeg' }), crop: downscaledUploadCrop(side) };
    }
  }
}

export function PhotoField({ photo, isPublished, dispatch, error, readOnly = false }: PhotoFieldProps) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [crop, setCrop] = useState<CropBox | null>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  // KAN-487: the picked image is DRAWN onto canvases from the decoded
  // HTMLImageElement, so no URL string ever reaches an <img src> (CodeQL
  // js/xss-through-dom).
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const pendingUrl = useRef<string | null>(null);

  // Free the object URL when the pending image changes or the field unmounts.
  useEffect(() => {
    pendingUrl.current = pending?.url ?? null;
  }, [pending]);
  useEffect(
    () => () => {
      if (pendingUrl.current) URL.revokeObjectURL(pendingUrl.current);
    },
    [],
  );

  // Move focus to the crop frame when the crop UI opens.
  useEffect(() => {
    if (pending) frameRef.current?.focus();
  }, [pending]);

  const clearPending = () => {
    if (pending) URL.revokeObjectURL(pending.url);
    setPending(null);
    setCrop(null);
  };

  const onPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // picking the same file again still fires change
    if (!file) return;
    setLocalError(null);
    const typeOrSize = preCheckPhotoFile(file);
    if (typeOrSize) {
      setLocalError(typeOrSize);
      return;
    }
    const url = safeObjectUrl(URL.createObjectURL(file));
    if (!url) return;
    const img = await loadImage(url);
    const dims = img ? checkPhotoDimensions(img.naturalWidth, img.naturalHeight) : PHOTO_UNREADABLE_ERROR;
    if (!img || dims) {
      URL.revokeObjectURL(url);
      setLocalError(dims ?? PHOTO_UNREADABLE_ERROR);
      return;
    }
    clearPending();
    setPending({ file, url, img, width: img.naturalWidth, height: img.naturalHeight });
    setCrop(initialCrop(img.naturalWidth, img.naturalHeight));
  };

  const onFrameKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!pending || !crop || busy) return;
    const next = applyCropKey(crop, e.key, pending.width, pending.height, e.shiftKey);
    if (next === null) return;
    e.preventDefault();
    setCrop(next);
  };

  const onImageClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!pending || !crop || busy) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = displayToNatural(
      e.clientX - rect.left,
      e.clientY - rect.top,
      rect.width,
      rect.height,
      pending.width,
      pending.height,
    );
    setCrop(centreCropAt(crop, p.x, p.y, pending.width, pending.height));
    frameRef.current?.focus();
  };

  const resizeBy = (sign: 1 | -1) => {
    if (!pending || !crop) return;
    const step = cropStep(pending.width, pending.height, true);
    setCrop(resizeCrop(crop, sign * step, pending.width, pending.height));
  };

  const onUse = async () => {
    if (!pending || !crop || busy) return;
    setBusy(true);
    setLocalError(null);
    try {
      const prepared = await prepareUpload(pending, crop);
      if ('error' in prepared) {
        setLocalError(prepared.error);
        return;
      }
      const fd = new FormData();
      fd.append('avatar', prepared.file);
      fd.append('cropX', String(prepared.crop.x));
      fd.append('cropY', String(prepared.crop.y));
      fd.append('cropSize', String(prepared.crop.size));
      const result = await stageProfilePhoto(fd);
      if (!result.ok) {
        setLocalError(result.error);
        return;
      }
      dispatch({ type: 'setPhoto', photo: { kind: 'staged', path: result.path, previewUrl: result.previewUrl } });
      clearPending();
      inputRef.current?.focus();
    } catch {
      setLocalError(PHOTO_UNREADABLE_ERROR);
    } finally {
      setBusy(false);
    }
  };

  const onCancelCrop = () => {
    clearPending();
    setLocalError(null);
    inputRef.current?.focus();
  };

  const current = photoUrl(photo);
  const blocked = isPublished && (photo.kind === 'removed' || photo.kind === 'none');
  // The blocking note already says what the validator's photo error says.
  const fieldError = localError ?? (error && !(blocked && error === PUBLISHED_PHOTO_ERROR) ? error : undefined);
  const describedById = describedBy(
    `${PHOTO_INPUT_ID}-help`,
    blocked && `${PHOTO_INPUT_ID}-note`,
    fieldError && `${PHOTO_INPUT_ID}-error`,
  );

  const overlay = pending && crop ? cropOverlayPercent(crop, pending.width, pending.height) : null;
  const preview = Boolean(pending && crop);

  useEffect(() => {
    const canvas = mainCanvasRef.current;
    if (!pending || !canvas) return;
    canvas.width = pending.width;
    canvas.height = pending.height;
    canvas.getContext('2d')?.drawImage(pending.img, 0, 0);
  }, [pending]);

  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!pending || !crop || !canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, PREVIEW_BOX, PREVIEW_BOX);
    ctx.drawImage(pending.img, crop.x, crop.y, crop.size, crop.size, 0, 0, PREVIEW_BOX, PREVIEW_BOX);
  }, [pending, crop]);

  return (
    <div>
      <label htmlFor={PHOTO_INPUT_ID} className={LABEL_CLASS}>
        Profile photo
        <span aria-hidden="true" className="text-[var(--color-muted)]"> *</span>
        <span className="sr-only"> (required)</span>
      </label>
      <p id={`${PHOTO_INPUT_ID}-help`} className={HELPER_CLASS}>
        {PHOTO_HINT}
      </p>

      <div className="flex items-start gap-4">
        <div className="w-24 h-24 shrink-0 rounded-full overflow-hidden border border-[var(--color-border)] bg-[var(--color-paper)]">
          {current && (
            // eslint-disable-next-line @next/next/no-img-element -- KAN-487: staged/stored photo is a Supabase Storage public URL, not an asset for the Next/Image optimizer.
            <img src={current} alt="Profile photo" className="w-full h-full object-cover" />
          )}
        </div>
        <div className="min-w-0 flex-1 space-y-2">
          <input
            ref={inputRef}
            id={PHOTO_INPUT_ID}
            type="file"
            accept={PHOTO_ACCEPT}
            onChange={onPick}
            disabled={readOnly || busy}
            aria-invalid={fieldError ? true : undefined}
            aria-describedby={describedById}
            className={`block w-full text-sm text-[var(--color-muted)] file:mr-3 file:px-4 file:py-2 file:rounded-lg file:border-0 file:bg-[#f4efe7] file:text-sm file:font-medium file:text-[var(--color-ink)] hover:file:bg-[#ece7df] disabled:opacity-50 ${FOCUS}`}
          />
          {current && !pending && (
            <button
              type="button"
              onClick={() => setConfirmOpen(true)}
              disabled={readOnly || busy}
              className={`text-sm font-medium px-2 py-1 -ml-2 rounded-lg text-red-600 hover:text-red-700 disabled:opacity-50 ${FOCUS}`}
            >
              Remove photo
            </button>
          )}
        </div>
      </div>

      {pending && crop && overlay && preview && (
        <div className="mt-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-paper)] p-4 space-y-3">
          <div className="flex flex-wrap items-start gap-4">
            <div className="relative inline-block max-w-full overflow-hidden cursor-crosshair select-none" onClick={onImageClick}>
              <canvas ref={mainCanvasRef} aria-hidden="true" className="block max-w-full max-h-[320px] w-auto h-auto" />
              <div
                ref={frameRef}
                tabIndex={0}
                role="group"
                aria-roledescription="crop area"
                aria-label="Crop area: arrow keys move it, plus and minus resize it."
                onKeyDown={onFrameKey}
                className="absolute border-2 border-white shadow-[0_0_0_9999px_rgba(0,0,0,0.45)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--color-sage)] focus-visible:outline-offset-[-5px]"
                style={{
                  left: `${overlay.left}%`,
                  top: `${overlay.top}%`,
                  width: `${overlay.width}%`,
                  height: `${overlay.height}%`,
                }}
              />
            </div>
            <div
              className="relative overflow-hidden rounded-full border border-[var(--color-border)] bg-white shrink-0"
              style={{ width: PREVIEW_BOX, height: PREVIEW_BOX }}
              aria-hidden="true"
            >
              <canvas ref={previewCanvasRef} width={PREVIEW_BOX} height={PREVIEW_BOX} className="block w-full h-full" />
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => resizeBy(-1)}
              disabled={busy}
              aria-label="Make the crop area smaller"
              className={ICON_BUTTON}
            >
              −
            </button>
            <button
              type="button"
              onClick={() => resizeBy(1)}
              disabled={busy}
              aria-label="Make the crop area larger"
              className={ICON_BUTTON}
            >
              +
            </button>
            <span className="flex-1" />
            <button type="button" onClick={onCancelCrop} disabled={busy} className={SECONDARY_BUTTON}>
              Cancel
            </button>
            <button type="button" onClick={onUse} disabled={busy} aria-busy={busy || undefined} className={PRIMARY_BUTTON}>
              Use this photo
            </button>
          </div>
        </div>
      )}

      <p role="status" aria-live="polite" className="sr-only">
        {busy ? 'Uploading photo…' : ''}
      </p>

      {blocked && (
        <p
          id={`${PHOTO_INPUT_ID}-note`}
          className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-700"
        >
          {PHOTO_PUBLISHED_BLOCK_NOTE}
        </p>
      )}
      {fieldError && (
        <p id={`${PHOTO_INPUT_ID}-error`} className={ERROR_CLASS}>
          {fieldError}
        </p>
      )}

      <ConfirmDialog
        open={confirmOpen}
        title="Remove your profile photo?"
        confirmLabel="Remove photo"
        cancelLabel="Cancel"
        onConfirm={() => {
          dispatch({ type: 'requestPhotoRemoval' });
          setConfirmOpen(false);
          setLocalError(null);
          // The Remove button is gone once the photo is removed; after the
          // dialog has closed, put focus on the picker instead.
          requestAnimationFrame(() => inputRef.current?.focus());
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
