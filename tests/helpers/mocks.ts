/**
 * Mock factories for Supabase and Gemini in test contexts.
 * 
 * These create chainable mock objects that mimic the Supabase client's
 * fluent query builder API (.from().select().eq().single(), etc.)
 */

/**
 * Creates a mock Supabase query chain. Every method returns `this` for chaining,
 * except `.single()` / the terminal method which returns the specified data.
 * 
 * Usage:
 *   const mock = createMockQueryChain({ data: { id: '123', status: 'PENDING' }, error: null });
 *   mock.from('any_table').select('*').eq('id', '123').single()
 *   // → { data: { id: '123', status: 'PENDING' }, error: null }
 */
export function createMockQueryChain(response: { data: any; error: any }) {
  const chain: any = {
    from: () => chain,
    select: () => chain,
    insert: () => chain,
    update: () => chain,
    delete: () => chain,
    eq: () => chain,
    neq: () => chain,
    in: () => chain,
    is: () => chain,
    lt: () => chain,
    gt: () => chain,
    order: () => chain,
    limit: () => chain,
    single: () => Promise.resolve(response),
    then: (resolve: any) => Promise.resolve(response).then(resolve),
  };
  return chain;
}

/**
 * Creates a multi-response mock where different `.from()` tables return
 * different data. Useful for auth tests that query multiple tables.
 * 
 * Usage:
 *   const mock = createMultiTableMock({
 *     'interview_sessions': { data: { status: 'PENDING', ... }, error: null },
 *     'invite_tokens': { data: { expires_at: '...', ... }, error: null },
 *   });
 */
export function createMultiTableMock(tableResponses: Record<string, { data: any; error: any }>) {
  const createChain = (response: { data: any; error: any }) => {
    const chain: any = {
      select: () => chain,
      insert: () => ({ then: (resolve: any) => Promise.resolve(response).then(resolve), error: response.error }),
      update: () => chain,
      delete: () => chain,
      eq: () => chain,
      neq: () => chain,
      in: () => chain,
      is: () => chain,
      lt: () => chain,
      gt: () => chain,
      order: () => chain,
      limit: () => chain,
      single: () => Promise.resolve(response),
      then: (resolve: any) => Promise.resolve(response).then(resolve),
    };
    return chain;
  };

  return {
    from: (table: string) => {
      const response = tableResponses[table] || { data: null, error: { message: `No mock for table: ${table}` } };
      return createChain(response);
    },
    auth: {
      getUser: () => Promise.resolve({ data: { user: null }, error: { message: 'Not authenticated' } }),
    },
  };
}

/**
 * Standard valid invite token fixture data for auth tests.
 */
export const VALID_TOKEN_FIXTURE = {
  id: 'token-abc',
  expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // +24h
  revoked: false,
  is_used: false,
  max_uses: 100,
  use_count: 0,
};

export const VALID_SESSION_FIXTURE = {
  status: 'PENDING',
  created_at: new Date().toISOString(), // just now
};
