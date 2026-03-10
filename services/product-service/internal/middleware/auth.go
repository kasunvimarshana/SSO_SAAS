package middleware

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

// validateResponse matches the shape returned by the Auth Service validate endpoint:
//
//	{ "success": true, "data": { "userId": "...", "email": "...", "role": "..." } }
type validateResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message"`
	Data    struct {
		UserID string `json:"userId"`
		Email  string `json:"email"`
		Role   string `json:"role"`
	} `json:"data"`
}

// AuthRequired validates the Bearer token against the Auth Service.
func AuthRequired(authServiceURL string) gin.HandlerFunc {
	return func(ctx *gin.Context) {
		authHeader := ctx.GetHeader("Authorization")
		if authHeader == "" {
			ctx.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"status":  "error",
				"message": "authorization header is required",
			})
			return
		}

		parts := strings.SplitN(authHeader, " ", 2)
		if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
			ctx.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"status":  "error",
				"message": "invalid authorization header format",
			})
			return
		}
		token := parts[1]

		req, err := http.NewRequestWithContext(ctx.Request.Context(),
			http.MethodGet,
			fmt.Sprintf("%s/api/auth/validate", authServiceURL),
			nil,
		)
		if err != nil {
			ctx.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"status":  "error",
				"message": "failed to build validation request",
			})
			return
		}
		req.Header.Set("Authorization", "Bearer "+token)

		client := &http.Client{}
		resp, err := client.Do(req)
		if err != nil {
			ctx.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
				"status":  "error",
				"message": "auth service unavailable",
			})
			return
		}
		defer resp.Body.Close()

		if resp.StatusCode != http.StatusOK {
			ctx.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"status":  "error",
				"message": "invalid or expired token",
			})
			return
		}

		body, err := io.ReadAll(resp.Body)
		if err != nil {
			ctx.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"status":  "error",
				"message": "failed to read auth response",
			})
			return
		}

		var validated validateResponse
		if err := json.Unmarshal(body, &validated); err != nil {
			ctx.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{
				"status":  "error",
				"message": "failed to parse auth response",
			})
			return
		}

		if !validated.Success {
			ctx.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{
				"status":  "error",
				"message": "invalid or expired token",
			})
			return
		}

		ctx.Set("userID", validated.Data.UserID)
		ctx.Set("userEmail", validated.Data.Email)
		ctx.Set("userRole", validated.Data.Role)
		ctx.Next()
	}
}

// AdminOnly permits only users whose role is "admin".
func AdminOnly() gin.HandlerFunc {
	return func(ctx *gin.Context) {
		role, _ := ctx.Get("userRole")
		if role != "admin" {
			ctx.AbortWithStatusJSON(http.StatusForbidden, gin.H{
				"status":  "error",
				"message": "admin access required",
			})
			return
		}
		ctx.Next()
	}
}
