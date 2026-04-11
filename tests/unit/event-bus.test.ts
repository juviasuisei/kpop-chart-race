import { EventBus } from '../../src/event-bus.ts';

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should deliver emitted data to a subscribed handler', () => {
    const received: string[] = [];
    bus.on('date:change', (date) => received.push(date));

    bus.emit('date:change', '2024-05-13');

    expect(received).toEqual(['2024-05-13']);
  });

  it('should call multiple handlers on the same event', () => {
    const calls: number[] = [];
    bus.on('play', () => calls.push(1));
    bus.on('play', () => calls.push(2));

    bus.emit('play');

    expect(calls).toEqual([1, 2]);
  });

  it('should unsubscribe only the specified handler', () => {
    const calls: string[] = [];
    const handlerA = (date: string) => calls.push(`A:${date}`);
    const handlerB = (date: string) => calls.push(`B:${date}`);

    bus.on('date:change', handlerA);
    bus.on('date:change', handlerB);
    bus.off('date:change', handlerA);

    bus.emit('date:change', '2024-06-01');

    expect(calls).toEqual(['B:2024-06-01']);
  });

  it('should not throw when emitting with no listeners', () => {
    expect(() => bus.emit('play')).not.toThrow();
    expect(() => bus.emit('date:change', '2024-01-01')).not.toThrow();
  });

  it('should pass correct arguments for loading:progress event', () => {
    let capturedLoaded: number | undefined;
    let capturedTotal: number | undefined;
    let capturedNames: string[] | undefined;

    bus.on('loading:progress', (loaded, total, artistNames) => {
      capturedLoaded = loaded;
      capturedTotal = total;
      capturedNames = artistNames;
    });

    bus.emit('loading:progress', 3, 12, ['aespa', 'TWICE', 'BTS']);

    expect(capturedLoaded).toBe(3);
    expect(capturedTotal).toBe(12);
    expect(capturedNames).toEqual(['aespa', 'TWICE', 'BTS']);
  });

  it('should pass a string argument for date:change event', () => {
    let capturedDate: string | undefined;
    bus.on('date:change', (date) => {
      capturedDate = date;
    });

    bus.emit('date:change', '2024-12-25');

    expect(capturedDate).toBe('2024-12-25');
  });
});
