import { validate } from 'class-validator';
import { RegisterDto } from './register.dto.js';

const validInput = {
  email: 'member@example.test',
  phone: '+2348012345678',
  password: 'Development-Password-123!',
  firstName: 'Ada',
  lastName: 'Member',
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

  it('requires the phone number in international format', async () => {
    for (const phone of ['08012345678', '2348012345678', '+234 801 234 5678', '+0812345678']) {
      const errors = await validate(Object.assign(new RegisterDto(), { ...validInput, phone }));
      expect(errors.map((error) => error.property)).toContain('phone');
    }
  });

  it('treats the referral code as optional but constrains its shape', async () => {
    await expect(validate(Object.assign(new RegisterDto(), validInput))).resolves.toHaveLength(0);

    await expect(
      validate(Object.assign(new RegisterDto(), { ...validInput, referralCode: 'AJO-2026' })),
    ).resolves.toHaveLength(0);

    const errors = await validate(
      Object.assign(new RegisterDto(), { ...validInput, referralCode: 'no spaces!' }),
    );
    expect(errors.map((error) => error.property)).toContain('referralCode');
  });
});
