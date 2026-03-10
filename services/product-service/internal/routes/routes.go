package routes

import (
	"github.com/gin-gonic/gin"

	"product-service/internal/controllers"
	"product-service/internal/middleware"
)

func Setup(router *gin.Engine, ctrl *controllers.ProductController, authServiceURL string) {
	api := router.Group("/api")

	// Public / health routes
	api.GET("/products/health", ctrl.HealthCheck)
	api.GET("/products/categories", ctrl.GetCategories)
	api.GET("/products", ctrl.GetProducts)
	api.GET("/products/:id", ctrl.GetProductByID)

	// Admin-only routes
	admin := api.Group("/products")
	admin.Use(middleware.AuthRequired(authServiceURL))
	admin.Use(middleware.AdminOnly())
	{
		admin.POST("", ctrl.CreateProduct)
		admin.PUT("/:id", ctrl.UpdateProduct)
		admin.DELETE("/:id", ctrl.DeleteProduct)
	}
}
