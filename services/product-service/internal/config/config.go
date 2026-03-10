package config

import (
	"fmt"
	"os"
)

type Config struct {
	Port           string
	DBHost         string
	DBPort         string
	DBName         string
	DBUser         string
	DBPassword     string
	AuthServiceURL string
	RabbitMQURL    string
}

func Load() *Config {
	return &Config{
		Port:           getEnv("PORT", "3003"),
		DBHost:         getEnv("DB_HOST", "localhost"),
		DBPort:         getEnv("DB_PORT", "5432"),
		DBName:         getEnv("DB_NAME", "product_db"),
		DBUser:         getEnv("DB_USER", "postgres"),
		DBPassword:     getEnv("DB_PASSWORD", ""),
		AuthServiceURL: getEnv("AUTH_SERVICE_URL", "http://localhost:3001"),
		RabbitMQURL:    getEnv("RABBITMQ_URL", "amqp://guest:guest@localhost:5672/"),
	}
}

func (c *Config) DSN() string {
	return fmt.Sprintf(
		"host=%s port=%s user=%s password=%s dbname=%s sslmode=disable TimeZone=UTC",
		c.DBHost, c.DBPort, c.DBUser, c.DBPassword, c.DBName,
	)
}

func getEnv(key, defaultValue string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return defaultValue
}
