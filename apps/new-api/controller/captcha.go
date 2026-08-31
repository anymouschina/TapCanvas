package controller

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const captchaTTL = 10 * time.Minute

type captchaChallenge struct {
	Answer  string
	Expires time.Time
}

var captchaStore = struct {
	sync.Mutex
	items map[string]captchaChallenge
}{items: make(map[string]captchaChallenge)}

func GetCaptcha(c *gin.Context) {
	a := randomCaptchaDigit()
	b := randomCaptchaDigit()
	answer := strconv.Itoa(a + b)
	token := uuid.NewString()

	captchaStore.Lock()
	cleanupExpiredCaptchas(time.Now())
	captchaStore.items[token] = captchaChallenge{Answer: answer, Expires: time.Now().Add(captchaTTL)}
	captchaStore.Unlock()

	question := fmt.Sprintf("%d + %d = ?", a, b)
	image := "data:image/svg+xml;base64," + base64.StdEncoding.EncodeToString([]byte(fmt.Sprintf(
		`<svg xmlns="http://www.w3.org/2000/svg" width="180" height="56" viewBox="0 0 180 56"><rect width="180" height="56" rx="8" fill="#202027"/><path d="M8 42L172 12M20 10L160 48" stroke="#6d5dfc" stroke-opacity=".28" stroke-width="2"/><text x="90" y="37" text-anchor="middle" font-family="Arial,sans-serif" font-size="25" font-weight="700" fill="#fff">%s</text></svg>`, question)))
	c.JSON(http.StatusOK, gin.H{"success": true, "message": "", "data": gin.H{"token": token, "image": image, "expires_in": int(captchaTTL.Seconds())}})
}

func verifyCaptcha(token, answer string) bool {
	token = strings.TrimSpace(token)
	answer = strings.TrimSpace(answer)
	if token == "" || answer == "" {
		return false
	}
	captchaStore.Lock()
	defer captchaStore.Unlock()
	challenge, ok := captchaStore.items[token]
	delete(captchaStore.items, token)
	return ok && time.Now().Before(challenge.Expires) && answer == challenge.Answer
}

func cleanupExpiredCaptchas(now time.Time) {
	for token, challenge := range captchaStore.items {
		if now.After(challenge.Expires) {
			delete(captchaStore.items, token)
		}
	}
}

func randomCaptchaDigit() int {
	code := common.GenerateVerificationCode(1)
	if code == "" {
		return 1
	}
	value, err := strconv.Atoi(code)
	if err != nil {
		return 1
	}
	return value
}
