import { useId, useState } from 'react';
import { RichText } from '../../components/RichText';
import { Button, Dialog, Field } from '../../components/ui';
import { mediaFor } from '../../lib/markdown';

const KIND_LABEL = { image: 'Image', video: 'Video file', player: '' } as const;

/** Asks for a link to an image or video and returns the mark to insert: ![description](link). */
export function MediaDialog({ open, onClose, onInsert }: { open: boolean; onClose: () => void; onInsert: (mark: string) => void }) {
  const [url, setUrl] = useState('');
  const [alt, setAlt] = useState('');
  const id = useId();
  const link = url.trim();
  const media = link ? mediaFor(link) : null;
  const error = link && !media ? 'Use a full link that starts with https://' : null;
  // The mark can't contain brackets in the description, or parentheses and spaces in the link.
  const mark = media ? `![${alt.replace(/[[\]\n]/g, ' ').trim()}](${link.replace(/\(/g, '%28').replace(/\)/g, '%29').replace(/\s/g, '%20')})` : '';
  const close = () => {
    setUrl('');
    setAlt('');
    onClose();
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add an image or video"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={!media}
            onClick={() => {
              onInsert(mark);
              close();
            }}
          >
            Add
          </Button>
        </>
      }
    >
      <div className="media-form">
        <Field
          label="Link"
          htmlFor={`${id}-url`}
          error={error}
          hint={
            media
              ? media.kind === 'player'
                ? `${media.provider} video. It plays from ${media.provider}, which then sees respondents’ visits; a video file on your own web space avoids that.`
                : `${KIND_LABEL[media.kind]}. Shown from where it’s stored, so it must be publicly reachable.`
              : 'A picture or video file on the web (.jpg, .png, .mp4, .webm), or a YouTube, Vimeo or Google Drive link (shared with “Anyone with the link”).'
          }
        >
          <input id={`${id}-url`} className="input" type="url" value={url} placeholder="https://" autoFocus onChange={(e) => setUrl(e.target.value)} />
        </Field>
        <Field label="Description" htmlFor={`${id}-alt`} hint="Read out by screen readers. For a video, a short summary of what it shows.">
          <input id={`${id}-alt`} className="input" value={alt} onChange={(e) => setAlt(e.target.value)} />
        </Field>
        {media && (
          <div className="media-preview">
            <RichText text={mark} />
          </div>
        )}
      </div>
    </Dialog>
  );
}
