package main

import (
	"log"

	"github.com/gin-gonic/gin"
	"github.com/joho/godotenv"

	"product-service/internal/config"
	"product-service/internal/controllers"
	"product-service/internal/repository"
	"product-service/internal/routes"
	"product-service/internal/services"
)

func main() {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found, reading environment variables directly")
	}

	cfg := config.Load()

	db := config.InitDB(cfg)

	mq := config.InitRabbitMQ(cfg.RabbitMQURL)
	defer mq.Close()

	productRepo := repository.NewProductRepository(db)
	productSvc := services.NewProductService(productRepo, mq)
	productCtrl := controllers.NewProductController(productSvc)

	router := gin.Default()

	router.Use(func(c *gin.Context) {
		c.Header("X-Service", "product-service")
		c.Next()
	})

	routes.Setup(router, productCtrl, cfg.AuthServiceURL)

	log.Printf("product service listening on port %s", cfg.Port)
	if err := router.Run(":" + cfg.Port); err != nil {
		log.Fatalf("failed to start server: %v", err)
	}
}
