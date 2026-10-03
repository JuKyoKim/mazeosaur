import Phaser from "phaser";
import { COLORS, text } from "./theme.js";

export interface Button {
  bg: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  /**
   * Extra display objects that belong to this button — a silhouette, a cost
   * line — so that showing or hiding it is one call and a new part cannot be
   * forgotten at the call site. The tray swaps twelve of these at a time.
   */
  parts: Phaser.GameObjects.Components.Visible[];
  add<T extends Phaser.GameObjects.Components.Visible>(part: T): T;
  setVisible(v: boolean): void;
}

export interface ButtonOptions {
  size?: number;
  fill?: number;
  /** a disabled button is drawn flat, takes no pointer and never fires */
  enabled?: boolean;
}

/**
 * A labelled rectangle. The pointer event stops at the button so a tap on
 * the HUD never also lands on the board behind it, and preventDefault
 * keeps a touch from turning into a synthetic click or a page scroll.
 */
export function makeButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  label: string,
  onClick: () => void,
  opts: ButtonOptions = {},
): Button {
  const enabled = opts.enabled ?? true;
  const fill = opts.fill ?? (enabled ? COLORS.button : COLORS.hudPanel);
  const bg = scene.add.rectangle(x, y, w, h, fill).setOrigin(0, 0);
  const t = scene.add
    .text(x + w / 2, y + h / 2, label, text(opts.size ?? 20, enabled ? COLORS.text : COLORS.textDim))
    .setOrigin(0.5)
    .setAlign("center");
  if (enabled) {
    bg.setInteractive({ useHandCursor: true });
    bg.on("pointerdown", (p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onClick();
      p.event.preventDefault?.();
    });
  }
  const button: Button = {
    bg,
    label: t,
    parts: [],
    add(part) {
      this.parts.push(part);
      return part;
    },
    setVisible(v) {
      bg.setVisible(v);
      // A hidden button must also stop taking the pointer, or the invisible
      // shop keeps swallowing taps meant for the sheet on top of it.
      if (bg.input) bg.input.enabled = v;
      t.setVisible(v);
      for (const part of this.parts) part.setVisible(v);
    },
  };
  return button;
}
