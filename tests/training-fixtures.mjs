export const bytes = (value) => new TextEncoder().encode(JSON.stringify(value)).buffer;
export function deltas(events) {
  let time = 0, x = 0, y = 0;
  return events.map(([at, column, row, action]) => {
    const nextX = Math.floor(column * 32), nextY = Math.floor(row * 32);
    const event = [at - time, nextX - x, nextY - y, action];
    time = at; x = nextX; y = nextY;
    return event;
  });
}
export function leftFixture() {
  const events = [[0, .5, .5, 2]];
  for (let index = 1; index < 32; index++) {
    const column = index % 8 + .5, row = Math.floor(index / 8) + .5;
    events.push([index * 20 - 5, column, row, 1], [index * 20, column, row, 2]);
  }
  return { game: 'left-click', rankingKey: 'left-click-b-50-v1', scoreMs: 620, playerIdentifier: '训练测试',
    replay: { version: 1, cellSize: 32, initialBoard: 'AAAAAP////8', events: deltas(events), specialEvents: [] } };
}
export function flagFixture(intermediate = false) {
  const questions = intermediate
    ? Array.from({ length: 15 }, (_, index) => [Math.floor(index / 5) * 4 + 1, index % 5 * 3 + 1, 0])
    : [[1, 1, 0], [1, 5, 0], [5, 1, 0], [5, 5, 0]];
  const events = questions.flatMap(([row, column], index) => [
    [index * 100, column - .5, row - .5, 3],
    [index * 100 + 20, column + .5, row + .5, 1],
    [index * 100 + 40, column + .5, row + .5, 2],
    ...(index < questions.length - 1 ? [[index * 100 + 45, column + .5, row + .5, 4]] : []),
  ]);
  return { game: 'flag-chord', rankingKey: `flag-chord-${intermediate ? 'i' : 'b'}-v1`, scoreMs: (questions.length - 1) * 100 + 40,
    replay: { version: 1, cellSize: 32, initialBoard: questions, events: deltas(events), specialEvents: [] } };
}
