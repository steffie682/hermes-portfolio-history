export function hasExpectedOrigin(request: Request, expectedOrigin: string): boolean {
  return request.headers.get('origin') === expectedOrigin;
}
