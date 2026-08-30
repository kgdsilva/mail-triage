-- Personal mail arrives in a business scan pile regularly, and "why was this archived?"
-- deserves a better answer than OTHER.
ALTER TYPE "DispositionReason" ADD VALUE IF NOT EXISTS 'NOT_COMPANY_MAIL' BEFORE 'OTHER';
