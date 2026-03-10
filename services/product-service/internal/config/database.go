package config

import (
	"log"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"product-service/internal/models"
)

func InitDB(cfg *Config) *gorm.DB {
	db, err := gorm.Open(postgres.Open(cfg.DSN()), &gorm.Config{
		Logger: logger.Default.LogMode(logger.Info),
	})
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}

	if err := db.AutoMigrate(&models.Product{}); err != nil {
		log.Fatalf("failed to run migrations: %v", err)
	}

	log.Println("database connected and migrations applied")
	return db
}
