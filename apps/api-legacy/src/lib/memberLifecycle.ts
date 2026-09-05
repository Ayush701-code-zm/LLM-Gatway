import { AppError } from '../middleware/errorHandler';

/** Validates that an owner may leave (must transfer first if others remain). */
export function assertOwnerCanLeave(otherMemberCount: number, workspaceName: string): void {
  if (otherMemberCount > 0) {
    throw AppError.conflict(
      `Transfer ownership of "${workspaceName}" before leaving the workspace`,
    );
  }
}
