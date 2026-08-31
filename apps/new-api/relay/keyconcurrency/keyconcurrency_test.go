package keyconcurrency

import "testing"

func TestTryAcquireUnlimited(t *testing.T) {
	// limit <= 0 => 不限制,总是成功,release 空操作可安全调用。
	for i := 0; i < 100; i++ {
		release, ok := TryAcquire(1, 0, 0)
		if !ok {
			t.Fatalf("limit=0 应总是成功,第 %d 次失败", i)
		}
		release()
	}
	if got := InFlight(1, 0); got != 0 {
		t.Fatalf("不限制模式不应计数,InFlight=%d", got)
	}
}

func TestTryAcquireLimitAndFailover(t *testing.T) {
	const ch, key, limit = 7, 2, 2

	r1, ok1 := TryAcquire(ch, key, limit)
	r2, ok2 := TryAcquire(ch, key, limit)
	if !ok1 || !ok2 {
		t.Fatalf("前两次应抢到槽位: ok1=%v ok2=%v", ok1, ok2)
	}
	if got := InFlight(ch, key); got != limit {
		t.Fatalf("InFlight 应为 %d,实际 %d", limit, got)
	}

	// 第三次:账号已满,应失败(调用方据此换号)。
	if r3, ok3 := TryAcquire(ch, key, limit); ok3 || r3 != nil {
		t.Fatalf("满槽应失败: ok3=%v r3nil=%v", ok3, r3 == nil)
	}

	// 释放一个 => 腾出一个槽位,可再抢到。
	r1()
	if got := InFlight(ch, key); got != 1 {
		t.Fatalf("释放一个后 InFlight 应为 1,实际 %d", got)
	}
	r4, ok4 := TryAcquire(ch, key, limit)
	if !ok4 {
		t.Fatalf("腾出槽位后应能再抢到")
	}

	// release 幂等:重复调用只减一次。
	r1()
	r1()
	r2()
	r4()
	if got := InFlight(ch, key); got != 0 {
		t.Fatalf("全部释放后 InFlight 应为 0,实际 %d", got)
	}
}

func TestSlotIsolationPerKey(t *testing.T) {
	// 同渠道不同账号(不同 keyIndex)各自独立计数,互不影响。
	const ch, limit = 9, 1
	rA, okA := TryAcquire(ch, 0, limit)
	rB, okB := TryAcquire(ch, 1, limit)
	if !okA || !okB {
		t.Fatalf("不同 keyIndex 应各自独立抢到: okA=%v okB=%v", okA, okB)
	}
	if _, ok := TryAcquire(ch, 0, limit); ok {
		t.Fatalf("account 0 已满,不应再抢到")
	}
	rA()
	rB()
}
