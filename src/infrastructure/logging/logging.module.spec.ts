import { developmentLogTransport } from './logging.module.js';

describe('developmentLogTransport', () => {
  it('enables readable console logs only in development', () => {
    expect(developmentLogTransport('development')).toEqual({
      target: 'pino-pretty',
      options: {
        colorize: true,
        ignore: 'pid,hostname',
        singleLine: true,
        translateTime: 'SYS:standard',
      },
    });
  });

  it.each(['test', 'production'] as const)('keeps %s logs structured', (environment) => {
    expect(developmentLogTransport(environment)).toBeUndefined();
  });
});
