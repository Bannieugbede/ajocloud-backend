import { validate } from 'class-validator';
import { RegisterDto } from './register.dto.js';

const validInput = {
  email: 'member@example.test',
  password: 'Development-Password-123!',
  firstName: 'Ada',
  lastName: 'Member',
  phone: '+2348012345678',
  acceptedTerms: true,
  acceptedPrivacy: true,
};

describe('RegisterDto', () => {
  it('accepts a complete Nigerian member registration', async () => {
    await expect(validate(Object.assign(new RegisterDto(), validInput))).resolves.toHaveLength(0);
  });

  it('rejects invalid phone and missing consent', async () => {
    const errors = await validate(
      Object.assign(new RegisterDto(), {
        ...validInput,
        phone: '08012345678',
        acceptedPrivacy: false,
      }),
    );
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['phone', 'acceptedPrivacy']),
    );
  });
});
