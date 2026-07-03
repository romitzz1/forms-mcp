import { createBearerAuthMiddleware } from '../../utils/httpTransport';

function mockRes() {
  const res: any = { statusCode: 200, body: undefined };
  res.status = (c: number) => { res.statusCode = c; return res; };
  res.json = (b: unknown) => { res.body = b; return res; };
  return res;
}

describe('createBearerAuthMiddleware', () => {
  it('calls next() when the Authorization header matches the expected bearer token', () => {
    const mw = createBearerAuthMiddleware('sekret');
    const req: any = { headers: { authorization: 'Bearer sekret' } };
    const res = mockRes();
    let called = false;
    mw(req, res, () => { called = true; });
    expect(called).toBe(true);
    expect(res.statusCode).toBe(200);
  });

  it('responds 401 and does not call next() when the token is missing or wrong', () => {
    const mw = createBearerAuthMiddleware('sekret');
    for (const authorization of [undefined, 'Bearer nope', 'sekret']) {
      const req: any = { headers: { authorization } };
      const res = mockRes();
      let called = false;
      mw(req, res, () => { called = true; });
      expect(called).toBe(false);
      expect(res.statusCode).toBe(401);
    }
  });
});
