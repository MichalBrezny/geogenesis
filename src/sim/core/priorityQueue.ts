/**
 * Binary min-heap of cell indices keyed by a number (e.g. elevation).
 * Fixed capacity, no allocations after construction.
 */
export class CellPriorityQueue {
  private readonly items: Int32Array;
  private readonly keys: Float64Array;
  private count = 0;

  constructor(capacity: number) {
    this.items = new Int32Array(capacity);
    this.keys = new Float64Array(capacity);
  }

  get size(): number {
    return this.count;
  }

  push(item: number, key: number): void {
    if (this.count === this.items.length) throw new Error('CellPriorityQueue is full');
    let i = this.count++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent]! <= key) break;
      this.items[i] = this.items[parent]!;
      this.keys[i] = this.keys[parent]!;
      i = parent;
    }
    this.items[i] = item;
    this.keys[i] = key;
  }

  /** Removes and returns the item with the smallest key. Undefined behaviour when empty. */
  pop(): number {
    const top = this.items[0]!;
    const lastItem = this.items[--this.count]!;
    const lastKey = this.keys[this.count]!;
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.count) break;
      if (child + 1 < this.count && this.keys[child + 1]! < this.keys[child]!) child++;
      if (this.keys[child]! >= lastKey) break;
      this.items[i] = this.items[child]!;
      this.keys[i] = this.keys[child]!;
      i = child;
    }
    this.items[i] = lastItem;
    this.keys[i] = lastKey;
    return top;
  }
}
