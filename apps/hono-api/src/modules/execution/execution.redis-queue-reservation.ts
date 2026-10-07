/** Only an unpublished reservation has a bounded lease; queued jobs do not expire. */
export const DISPATCH_PUBLICATION_LEASE_MS = 120_000;

export const RESERVE_DISPATCH_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current then
  local receipt = cjson.decode(current)
  local jobKey = ARGV[5] .. receipt.token
  local jobExists = redis.call('EXISTS', jobKey) == 1
  local finished = jobExists and redis.call('HEXISTS', jobKey, 'finishedOn') == 1
  local published = jobExists and not finished
  if published then redis.call('PERSIST', KEYS[1]) end
  local publishing = not jobExists and receipt.publishLeaseUntil and receipt.publishLeaseUntil > tonumber(ARGV[3])
  if (published or publishing) and receipt.dueAt <= tonumber(ARGV[2]) then return 0 end
end
redis.call('SET', KEYS[1], cjson.encode({
  token=ARGV[1], dueAt=tonumber(ARGV[2]), publishLeaseUntil=tonumber(ARGV[4])
}))
return 1
`;

export const CLAIM_DISPATCH_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current and cjson.decode(current).token == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** A lost add response must not revoke a job that BullMQ actually accepted. */
export const RELEASE_UNPUBLISHED_DISPATCH_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current and cjson.decode(current).token == ARGV[1] and redis.call('EXISTS', KEYS[2]) == 0 then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
