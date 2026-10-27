/** Mã operation hợp lệ để đưa vào URL / request (chặn giá trị lạ từ query string). */
export const OPERATION_ID_PATTERN = /^[A-Za-z0-9-]{8,64}$/;

export function isValidOperationId(value: string | null | undefined): value is string {
  return typeof value === 'string' && OPERATION_ID_PATTERN.test(value);
}
