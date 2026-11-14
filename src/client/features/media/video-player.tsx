import { Button, ButtonLink, IconButton } from "@/client/components/button";
import { shortcutTitle } from "@/client/components/keycap";
import { notifyMedia } from "./media-toast";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Slider, SliderThumb, SliderTrack, type SliderProps } from "react-aria-components";
import { useHotkeys, type UseHotkeyDefinition } from "@tanstack/react-hotkeys";
import { Debouncer } from "@tanstack/pacer";
import type { Attachment } from "@/shared/attachment-media";
import { Icon } from "@/client/components/icons";

const RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
import { downloadURL } from "./media-layout";
const time = (value: number) => {
  const seconds = Math.floor(Number.isFinite(value) ? value : 0);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
};
function Glyph({ name }: { name: "play" | "pause" | "volume" | "muted" | "pip" }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      aria-hidden
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {name === "play" ? (
        <path d="m5 3 8 5-8 5Z" fill="currentColor" stroke="none" />
      ) : name === "pause" ? (
        <path d="M5 3v10M11 3v10" strokeWidth="3" />
      ) : name === "pip" ? (
        <>
          <path d="M13 5V3H2v9h3" />
          <rect x="7" y="7" width="7" height="6" rx="1" fill="currentColor" stroke="none" />
        </>
      ) : (
        <>
          <path d="M7 3 3.5 6H1v4h2.5L7 13Z" fill="currentColor" stroke="none" />
          {name === "muted" ? (
            <path d="m10 6 4 4m0-4-4 4" />
          ) : (
            <>
              <path d="M10 5a4 4 0 0 1 0 6M12 3a7 7 0 0 1 0 10" />
            </>
          )}
        </>
      )}
    </svg>
  );
}

/**
 * The player's seek and volume sliders, React Aria's Slider rendered twice. Linear's `GUe` (seek) and `VUe` (volume) are one
 * `role="slider"` track each, driven by the shared `KUe` pointer hook: press jumps to the pointer and dragging follows it
 * (startup-root.CnUSfl4j.js). Their arrow keys belong to the player (`qUe`), so the player's capture-phase hotkeys take
 * them before React Aria's thumb does.
 */
export function VideoSlider({
  className,
  ...props
}: { className: string } & Omit<SliderProps<number>, "className" | "children">) {
  return (
    <Slider {...props} className={`video-slider ${className}`}>
      <SliderTrack
        className="video-slider-track"
        // The played or set part is the track's gradient stop, as the native range input's was.
        style={({ state }) => ({ "--video-progress": `${state.getThumbPercent(0) * 100}%` }) as CSSProperties}
      >
        <SliderThumb className="video-slider-thumb" />
      </SliderTrack>
    </Slider>
  );
}
type Snapshot = { time: number; volume: number; muted: boolean; rate: number; paused: boolean };
export function VideoPlayer({
  file,
  onSize,
  onSelect,
}: {
  file: Attachment;
  onSize: (size: { width: number; height: number }) => void;
  onSelect?: () => void;
}) {
  const root = useRef<HTMLDivElement>(null),
    video = useRef<HTMLVideoElement>(null),
    expand = useRef<HTMLButtonElement>(null),
    playButton = useRef<HTMLButtonElement>(null);
  const [playing, setPlaying] = useState(false),
    [ended, setEnded] = useState(false),
    [elapsed, setElapsed] = useState(0),
    [duration, setDuration] = useState(0),
    [volume, setVolume] = useState(1),
    [muted, setMuted] = useState(false),
    [rate, setRate] = useState(1);
  const [expanded, setExpanded] = useState(false),
    [pip, setPip] = useState(false),
    [visible, setVisible] = useState(false),
    [keyboardControls, setKeyboardControls] = useState(false),
    [waiting, setWaiting] = useState(false),
    [error, setError] = useState("");
  const [dimensions, setDimensions] = useState<{ width: number; height: number }>();
  const [hideControls] = useState(() => new Debouncer(() => setVisible(false), { wait: 2500 })),
    saved = useRef<Snapshot>({ time: 0, volume: 1, muted: false, rate: 1, paused: true }),
    restoring = useRef(false);
  const diagnostic = useRef<AbortController | undefined>(undefined);
  const broken = useRef(false);
  const openingFocus = useRef(false);
  const lastVolume = useRef(1);
  // Linear's seek slider pauses playback while it is scrubbed and resumes on release (`GUe`'s `d.current`).
  const resumeAfterScrub = useRef(false);
  const snapshot = () => {
    const v = video.current;
    if (v && v.readyState >= 1 && !broken.current && !restoring.current && !v.error)
      saved.current = {
        time: v.currentTime,
        volume: v.volume,
        muted: v.muted,
        rate: v.playbackRate,
        paused: v.paused,
      };
  };
  const reveal = () => {
    setVisible(true);
    hideControls.maybeExecute();
  };
  const play = () => {
    const v = video.current;
    if (!v || error) return;
    if (v.paused) {
      if (v.ended) v.currentTime = 0;
      void v.play().catch(() => {
        notifyMedia("Playback could not start. Press Play to try again.");
      });
    } else v.pause();
    reveal();
  };
  const seek = (to: number) => {
    const v = video.current;
    if (v && Number.isFinite(v.duration)) {
      v.currentTime = Math.max(0, Math.min(v.duration, to));
      setElapsed(v.currentTime);
      snapshot();
      reveal();
    }
  };
  const changeVolume = (to: number) => {
    const v = video.current;
    if (v) {
      v.volume = Math.max(0, Math.min(1, to));
      if (v.volume > 0) lastVolume.current = v.volume;
      v.muted = v.volume === 0;
      snapshot();
      reveal();
    }
  };
  const mute = () => {
    const v = video.current;
    if (v) {
      if (v.muted || v.volume === 0) {
        if (v.volume === 0) v.volume = lastVolume.current;
        v.muted = false;
      } else v.muted = true;
      snapshot();
      reveal();
    }
  };
  const changeRate = (to: number) => {
    if (video.current) {
      video.current.playbackRate = to;
      snapshot();
      reveal();
    }
  };
  const stepRate = (step: number) =>
    changeRate(
      RATES[
        Math.max(
          0,
          Math.min(RATES.length - 1, RATES.indexOf(video.current?.playbackRate ?? 1) + step),
        )
      ]!,
    );
  const picture = async () => {
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (video.current && document.pictureInPictureEnabled)
        await video.current.requestPictureInPicture();
      else notifyMedia("Picture-in-picture is unavailable in this browser.");
    } catch {
      notifyMedia("Picture-in-picture could not open. Try again after playback starts.");
    }
  };
  const toggleExpanded = () => {
    setKeyboardControls(false);
    setExpanded((value) => !value);
    reveal();
  };
  const exit = () => {
    if (expanded) setExpanded(false);
  };
  const arrow = (event: KeyboardEvent, action: () => void) => {
    if (event.target instanceof HTMLSelectElement) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  };
  const arrowOptions = { preventDefault: false, stopPropagation: false };
  useHotkeys(
    [
      { hotkey: "K", callback: play },
      { hotkey: "Space", callback: play, options: { ignoreInputs: true } },
      { hotkey: "M", callback: mute },
      { hotkey: "F", callback: toggleExpanded },
      { hotkey: "P", callback: () => void picture() },
      {
        hotkey: "ArrowLeft",
        callback: (event) =>
          arrow(event, () =>
            event.target instanceof Element && event.target.closest(".video-volume-slider")
              ? changeVolume((video.current?.volume ?? 1) - 0.05)
              : seek((video.current?.currentTime ?? 0) - 5),
          ),
        options: arrowOptions,
      },
      {
        hotkey: "ArrowRight",
        callback: (event) =>
          arrow(event, () =>
            event.target instanceof Element && event.target.closest(".video-volume-slider")
              ? changeVolume((video.current?.volume ?? 1) + 0.05)
              : seek((video.current?.currentTime ?? 0) + 5),
          ),
        options: arrowOptions,
      },
      {
        hotkey: "ArrowUp",
        callback: (event) => arrow(event, () => changeVolume((video.current?.volume ?? 1) + 0.05)),
        options: arrowOptions,
      },
      {
        hotkey: "ArrowDown",
        callback: (event) => arrow(event, () => changeVolume((video.current?.volume ?? 1) - 0.05)),
        options: arrowOptions,
      },
      { hotkey: ">", callback: () => stepRate(1) },
      { hotkey: "<", callback: () => stepRate(-1) },
      { hotkey: "Escape", callback: exit },
      {
        hotkey: "Mod+K",
        callback: () => setExpanded(false),
        options: { enabled: expanded, preventDefault: false, stopPropagation: false },
      },
      ...(["Tab", "Shift+Tab"] as const).map((hotkey) => ({
        hotkey,
        callback: () => {
          const items = [
            ...root.current!.querySelectorAll<HTMLElement>(
              "button:not(:disabled),a[href],select,input",
            ),
          ].filter((el) => el.getBoundingClientRect().width > 0);
          const index = items.indexOf(document.activeElement as HTMLElement),
            step = hotkey === "Tab" ? 1 : -1;
          items[
            index < 0
              ? step < 0
                ? items.length - 1
                : 0
              : (index + step + items.length) % items.length
          ]?.focus();
        },
        options: { enabled: expanded },
      })),
    ] as UseHotkeyDefinition[],
    {
      target: root,
      capture: true,
      ignoreInputs: false,
      preventDefault: true,
      stopPropagation: true,
    },
  );
  useEffect(() => {
    if (expanded) {
      const overflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      openingFocus.current = true;
      (playButton.current ?? root.current)?.focus();
      openingFocus.current = false;
      return () => {
        document.body.style.overflow = overflow;
        if (
          // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Fullscreen cleanup must inspect the current connected controls after DOM changes.
          root.current?.contains(document.activeElement) ||
          document.activeElement === document.body
        )
          // oxlint-disable-next-line react-hooks/exhaustive-deps, react/exhaustive-effect-dependencies -- Fullscreen cleanup must inspect the current connected controls after DOM changes.
          expand.current?.focus();
      };
    }
  }, [expanded]);
  useEffect(() => {
    const v = video.current!;
    const enter = () => setPip(true),
      leave = () => setPip(false);
    v.addEventListener("enterpictureinpicture", enter);
    v.addEventListener("leavepictureinpicture", leave);
    return () => {
      v.removeEventListener("enterpictureinpicture", enter);
      v.removeEventListener("leavepictureinpicture", leave);
    };
  }, []);
  useEffect(() => {
    const v = video.current;
    return () => {
      hideControls.cancel();
      diagnostic.current?.abort();
      if (v && document.pictureInPictureElement === v)
        void document.exitPictureInPicture().catch(() => {});
    };
  }, [hideControls]);
  const failed = () => {
    broken.current = true;
    video.current?.pause();
    if (root.current?.contains(document.activeElement)) root.current.focus();
    setWaiting(false);
    setPlaying(false);
    const code = video.current?.error?.code;
    setError(
      code === 3
        ? "This video could not be decoded. Download it to watch in another player."
        : code === 4
          ? "This video format is unavailable or its attachment could not be loaded."
          : "The video connection was interrupted. Retry to continue from your last position.",
    );
    if (!file.url.startsWith("/api/")) return;
    diagnostic.current?.abort();
    const abort = new AbortController();
    diagnostic.current = abort;
    void fetch(file.url, { headers: { Range: "bytes=0-0" }, signal: abort.signal })
      .then(async (response) => {
        await response.body?.cancel();
        if (abort.signal.aborted) return;
        if (response.status === 401 || response.status === 403)
          setError(
            "Jira denied access to this video. Check your Jira access or setup, then retry.",
          );
        else if (response.status === 404) setError("This video attachment is no longer available.");
        else if (response.status === 429)
          setError("Jira is limiting attachment requests. Wait a moment, then retry.");
        else if (!response.ok)
          setError(
            "The video connection was interrupted. Retry to continue from your last position.",
          );
      })
      .catch(() => {});
  };
  const retry = () => {
    diagnostic.current?.abort();
    restoring.current = true;
    broken.current = false;
    root.current?.focus();
    setError("");
    setWaiting(true);
    video.current?.load();
  };
  const metadata = () => {
    const v = video.current!;
    setDuration(v.duration);
    const size = { width: v.videoWidth, height: v.videoHeight };
    setDimensions(size);
    onSize(size);
    if (restoring.current) {
      const s = saved.current;
      v.currentTime = Math.min(s.time, Number.isFinite(v.duration) ? v.duration : s.time);
      v.volume = s.volume;
      v.muted = s.muted;
      v.playbackRate = s.rate;
      setElapsed(v.currentTime);
      restoring.current = false;
      if (!s.paused) void v.play().catch(() => {});
    }
    setWaiting(false);
  };
  const playLabel = playing ? "Pause" : ended ? "Replay" : "Play";
  // Expanded video keeps its live player mounted; a modal portal would restart playback.
  return (
    <div
      ref={root}
      data-video-player
      data-expanded={expanded}
      data-controls-visible={visible}
      data-keyboard-controls={keyboardControls}
      role={expanded ? "dialog" : "region"}
      aria-label={expanded ? "Expanded media player" : "Media player"}
      aria-modal={expanded || undefined}
      tabIndex={0}
      className={`video-player${expanded ? " video-expanded" : ""}`}
      onPointerMove={reveal}
      onPointerLeave={() => {
        hideControls.cancel();
        setVisible(false);
      }}
      onFocus={(event) => {
        if (
          !openingFocus.current &&
          event.target !== root.current &&
          event.target.matches(":focus-visible")
        )
          setKeyboardControls(true);
        reveal();
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setKeyboardControls(false);
          setVisible(false);
        }
      }}
      onKeyDownCapture={(event) => {
        if (event.key === "Tab") {
          setKeyboardControls(true);
          reveal();
        }
      }}
      onMouseDown={(event) => {
        setKeyboardControls(false);
        if (
          expanded &&
          !(event.target instanceof Element && event.target.closest("button,a,input,select"))
        ) {
          event.preventDefault();
          event.stopPropagation();
          root.current?.focus();
        }
      }}
    >
      {expanded && (
        <IconButton className="video-close" label="Exit full window" onClick={exit}>
          <Icon name="close" size={20} />
        </IconButton>
      )}
      <div
        className="video-stage"
        style={
          expanded && dimensions
            ? {
                width: `min(${dimensions.width}px, calc(100vw - 64px), calc((100vh - 64px) * ${dimensions.width / dimensions.height}))`,
                aspectRatio: `${dimensions.width}/${dimensions.height}`,
              }
            : undefined
        }
      >
        <video
          ref={video}
          data-attachment-id={file.id}
          aria-label={file.name}
          src={file.url}
          preload="metadata"
          playsInline
          tabIndex={-1}
          onClick={(event) => {
            event.currentTarget.focus();
            play();
          }}
          onDoubleClick={toggleExpanded}
          onLoadedMetadata={metadata}
          onTimeUpdate={() => {
            setElapsed(video.current!.currentTime);
            setEnded(video.current!.ended);
            snapshot();
          }}
          onPlay={() => {
            setPlaying(true);
            setEnded(false);
            snapshot();
          }}
          onPause={() => {
            setPlaying(false);
            snapshot();
          }}
          onEnded={() => {
            setPlaying(false);
            setEnded(true);
          }}
          onVolumeChange={() => {
            setVolume(video.current!.volume);
            setMuted(video.current!.muted);
            snapshot();
          }}
          onRateChange={() => {
            setRate(video.current!.playbackRate);
            snapshot();
          }}
          onWaiting={() => setWaiting(true)}
          onPlaying={() => setWaiting(false)}
          onCanPlay={() => setWaiting(false)}
          onError={failed}
        />
        {pip && (
          <div className="video-pip">
            <Glyph name="pip" />
            <span>Video playing in picture-in-picture</span>
            <Button variant="secondary" size="medium" onClick={() => void picture()}>
              Bring it here
            </Button>
          </div>
        )}
        {onSelect && !expanded && (
          <IconButton className="video-select" label="Select video" onClick={onSelect}>
            ⠿
          </IconButton>
        )}
        {waiting && !error && (
          <div className="video-waiting" role="status" aria-label="Loading video">
            <span className="video-spinner" />
          </div>
        )}
        {error && (
          <div className="video-error" role="alert">
            <p>
              <span className="video-error-full">{error}</span>
              <span className="video-error-short" aria-hidden>
                Video unavailable
              </span>
            </p>
            <div className="video-error-actions">
              <Button variant="secondary" size="medium" aria-label="Retry video" onClick={retry}>
                Retry video
              </Button>
              <ButtonLink variant="secondary" size="medium" href={downloadURL(file.url)} download={file.name}>
                Download video
              </ButtonLink>
            </div>
          </div>
        )}
        {/* Linear's player controls each sit in its Tooltip (`$`): the title and the key, as the app's tooltip shows every title. */}
        {!error && (
          <div
            className="video-controls"
            aria-label="Video controls"
            onPointerMove={(event) => {
              event.stopPropagation();
              reveal();
            }}
          >
            <IconButton
              ref={playButton}
              label={`${playLabel} (keyboard shortcut k)`}
              tooltip={playLabel}
              shortcut="Space"
              disabled={!!error}
              onClick={play}
            >
              {ended ? (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden
                >
                  <path
                    d="M3 6a5 5 0 1 1 0 4M3 2v4h4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <Glyph name={playing ? "pause" : "play"} />
              )}
            </IconButton>
            <div className="video-volume">
              <IconButton
                label={`${muted ? "Unmute" : "Mute"} (keyboard shortcut m)`}
                tooltip={muted ? "Unmute" : "Mute"}
                shortcut="M"
                onClick={mute}
              >
                <Glyph name={muted || volume === 0 ? "muted" : "volume"} />
              </IconButton>
              <div className="video-volume-popup">
                <VideoSlider
                  aria-label="Volume"
                  className="video-volume-slider"
                  orientation="vertical"
                  minValue={0}
                  maxValue={1}
                  step={0.05}
                  // Linear's volume reads as `${n}% volume`.
                  formatOptions={{ style: "percent" }}
                  value={muted ? 0 : volume}
                  onChange={changeVolume}
                />
              </div>
            </div>
            <span className="video-time" aria-label={`Elapsed ${time(elapsed)}`}>
              {time(elapsed)}
            </span>
            <VideoSlider
              aria-label="Seek slider"
              className="video-seek"
              minValue={0}
              maxValue={duration || 1}
              step={0.01}
              formatOptions={{ style: "unit", unit: "second", unitDisplay: "long", maximumFractionDigits: 0 }}
              value={Math.min(elapsed, duration || 1)}
              isDisabled={!duration || !!error}
              onPointerDownCapture={(event) => {
                const v = video.current;
                if (event.button !== 0 || !v || v.paused) return;
                resumeAfterScrub.current = true;
                v.pause();
              }}
              onChange={seek}
              onChangeEnd={() => {
                if (!resumeAfterScrub.current) return;
                resumeAfterScrub.current = false;
                void video.current?.play().catch(() => {});
              }}
            />
            <span className="video-time" aria-label={`Duration ${time(duration)}`}>
              {time(duration)}
            </span>
            <div className="video-rate">
              <select
                aria-label="Change playback rate (keyboard shortcut > or <)"
                title={shortcutTitle("Playback speed", "<", ">")}
                value={rate}
                onChange={(event) => changeRate(Number(event.target.value))}
              >
                {RATES.map((value) => (
                  <option key={value} value={value}>
                    {value}×
                  </option>
                ))}
              </select>
            </div>
            <a
              aria-label="Download"
              title="Download"
              href={downloadURL(file.url)}
              download={file.name}
            >
              <Icon name="download" size={16} />
            </a>
            <IconButton
              label="Picture-in-Picture (keyboard shortcut p)"
              tooltip="Picture-in-picture"
              shortcut="P"
              disabled={!document.pictureInPictureEnabled || !duration}
              onClick={() => void picture()}
            >
              <Glyph name="pip" />
            </IconButton>
            <IconButton
              ref={expand}
              label={`${expanded ? "Exit full window" : "Full window"} (keyboard shortcut f)`}
              tooltip={expanded ? "Exit full window" : "Full window"}
              shortcut="F"
              onClick={toggleExpanded}
            >
              <Icon name="expand" size={16} />
            </IconButton>
          </div>
        )}
      </div>
    </div>
  );
}
