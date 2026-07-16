import { AJO_CLOUD_BRAND } from './brand.config.js';

describe('public Ajo Cloud brand configuration', () => {
  it('exposes the canonical name and approved palette only', () => {
    expect(AJO_CLOUD_BRAND).toEqual({
      name: 'Ajo Cloud',
      colors: {
        primary: '#0D47A1',
        teal: '#15B0BB',
        skyBlue: '#4DD0E1',
        lightBlue: '#E3F6FA',
        darkGray: '#212B36',
        gray: '#637280',
      },
    });
  });
});
