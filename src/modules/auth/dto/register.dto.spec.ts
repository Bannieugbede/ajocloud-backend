import { validate } from 'class-validator';
import { RegisterDto } from './register.dto.js';

const validInput = {
  email: 'member@example.test',
  password: 'Development-Password-123!',
  firstName: 'Ada',
  lastName: 'Member',
  acceptedTerms: true,
  acceptedPrivacy: true,
};

describe('RegisterDto', () => {
  it('accepts an email-based member registration', async () => {
    await expect(validate(Object.assign(new RegisterDto(), validInput))).resolves.toHaveLength(0);
  });

  it('rejects an invalid email and missing consent', async () => {
    const errors = await validate(
      Object.assign(new RegisterDto(), {
        ...validInput,
        email: 'not-an-email',
        acceptedPrivacy: false,
      }),
    );
    expect(errors.map((error) => error.property)).toEqual(
      expect.arrayContaining(['email', 'acceptedPrivacy']),
    );
  });
});
