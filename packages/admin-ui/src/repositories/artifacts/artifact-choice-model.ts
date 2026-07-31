/**
 * How many of a set of choices to put on screen at once.
 *
 * A handful of versions read well as a row of them. Fifty do not: they become
 * a wall that pushes what you came to read off the bottom, and the one you
 * want is no easier to find for all of them being there. So the newest few are
 * shown and the rest wait behind a control that says how many they are.
 *
 * Whatever is selected is always among them. A chosen version that scrolled
 * out of the shown ones would leave the row with nothing marked, which reads
 * as nothing being chosen rather than as the choice being further down.
 */
export const CHOICES_SHOWN = 8;

export interface VisibleChoices<T> {
  shown: T[];
  /** How many are not shown; zero when they all are. */
  hidden: number;
}

export function visibleChoices<T>(input: {
  options: T[];
  isSelected: (option: T) => boolean;
  expanded: boolean;
  limit?: number;
}): VisibleChoices<T> {
  const limit = input.limit ?? CHOICES_SHOWN;
  if (input.expanded || input.options.length <= limit) {
    return { shown: input.options, hidden: 0 };
  }

  const shown = input.options.slice(0, limit);
  const selected = input.options.find(input.isSelected);
  // Put where the last of them was rather than moved to the front: the order
  // is what makes a version list readable, and reordering it under the reader
  // to keep one visible costs more than it saves.
  if (selected && !shown.includes(selected)) {
    shown[shown.length - 1] = selected;
  }
  return { shown, hidden: input.options.length - shown.length };
}

export function moreChoicesLabel(hidden: number): string {
  return `${hidden} more`;
}
