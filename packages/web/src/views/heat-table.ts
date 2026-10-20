import { flag, setVars } from '../dom.ts';

export type HeatCell = { text: string; shade: number; self?: boolean; dark?: boolean; diagonal?: boolean };

function headerCell(text: string, scope: 'col' | 'row') {
  const cell = document.createElement('th');
  cell.scope = scope;
  cell.textContent = text;
  return cell;
}

export function renderHeatTable(
  table: HTMLElement,
  labels: string[],
  cellAt: (row: number, column: number) => HeatCell,
) {
  const head = table.querySelector('thead tr') as HTMLTableRowElement;
  head.replaceChildren(head.cells[0] as HTMLTableCellElement, ...labels.map((label) => headerCell(label, 'col')));
  (table.querySelector('tbody') as HTMLElement).replaceChildren(
    ...labels.map((label, row) => {
      const element = document.createElement('tr');
      const cells = labels.map((_, column) => {
        const cell = document.createElement('td');
        const { text, shade, self = false, dark = false, diagonal = false } = cellAt(row, column);
        cell.textContent = text;
        setVars(cell, { '--a': shade.toFixed(3) });
        flag(cell, 'self', self);
        flag(cell, 'dark', dark);
        flag(cell, 'diag', diagonal);
        return cell;
      });
      element.append(headerCell(label, 'row'), ...cells);
      return element;
    }),
  );
}
