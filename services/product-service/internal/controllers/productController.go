package controllers

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"

	"product-service/internal/models"
	"product-service/internal/services"
)

type ProductController struct {
	service services.ProductService
}

func NewProductController(svc services.ProductService) *ProductController {
	return &ProductController{service: svc}
}

func (c *ProductController) HealthCheck(ctx *gin.Context) {
	ctx.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "product service is running",
	})
}

func (c *ProductController) GetProducts(ctx *gin.Context) {
	filter := models.ProductFilter{
		Page:     parseIntQuery(ctx, "page", 1),
		Limit:    parseIntQuery(ctx, "limit", 10),
		Category: ctx.Query("category"),
		Search:   ctx.Query("search"),
	}

	if minStr := ctx.Query("min_price"); minStr != "" {
		if v, err := strconv.ParseFloat(minStr, 64); err == nil {
			filter.MinPrice = &v
		} else {
			respondError(ctx, http.StatusBadRequest, "invalid min_price value")
			return
		}
	}
	if maxStr := ctx.Query("max_price"); maxStr != "" {
		if v, err := strconv.ParseFloat(maxStr, 64); err == nil {
			filter.MaxPrice = &v
		} else {
			respondError(ctx, http.StatusBadRequest, "invalid max_price value")
			return
		}
	}

	products, total, err := c.service.GetProducts(filter)
	if err != nil {
		if errors.Is(err, services.ErrInvalidPriceRange) {
			respondError(ctx, http.StatusBadRequest, err.Error())
			return
		}
		respondError(ctx, http.StatusInternalServerError, "failed to fetch products")
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data": gin.H{
			"products": products,
			"pagination": gin.H{
				"total": total,
				"page":  filter.Page,
				"limit": filter.Limit,
				"pages": totalPages(total, filter.Limit),
			},
		},
	})
}

func (c *ProductController) GetProductByID(ctx *gin.Context) {
	id := ctx.Param("id")
	product, err := c.service.GetProductByID(id)
	if err != nil {
		if errors.Is(err, services.ErrProductNotFound) {
			respondError(ctx, http.StatusNotFound, "product not found")
			return
		}
		respondError(ctx, http.StatusInternalServerError, "failed to fetch product")
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data":   gin.H{"product": product},
	})
}

func (c *ProductController) GetCategories(ctx *gin.Context) {
	categories, err := c.service.GetCategories()
	if err != nil {
		respondError(ctx, http.StatusInternalServerError, "failed to fetch categories")
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"status": "success",
		"data":   gin.H{"categories": categories},
	})
}

func (c *ProductController) CreateProduct(ctx *gin.Context) {
	var input models.CreateProductInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		respondError(ctx, http.StatusBadRequest, err.Error())
		return
	}

	product, err := c.service.CreateProduct(input)
	if err != nil {
		if errors.Is(err, services.ErrDuplicateSKU) {
			respondError(ctx, http.StatusConflict, err.Error())
			return
		}
		respondError(ctx, http.StatusInternalServerError, "failed to create product")
		return
	}

	ctx.JSON(http.StatusCreated, gin.H{
		"status":  "success",
		"message": "product created successfully",
		"data":    gin.H{"product": product},
	})
}

func (c *ProductController) UpdateProduct(ctx *gin.Context) {
	id := ctx.Param("id")

	var input models.UpdateProductInput
	if err := ctx.ShouldBindJSON(&input); err != nil {
		respondError(ctx, http.StatusBadRequest, err.Error())
		return
	}

	product, err := c.service.UpdateProduct(id, input)
	if err != nil {
		if errors.Is(err, services.ErrProductNotFound) {
			respondError(ctx, http.StatusNotFound, "product not found")
			return
		}
		if errors.Is(err, services.ErrDuplicateSKU) {
			respondError(ctx, http.StatusConflict, err.Error())
			return
		}
		respondError(ctx, http.StatusInternalServerError, "failed to update product")
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "product updated successfully",
		"data":    gin.H{"product": product},
	})
}

func (c *ProductController) DeleteProduct(ctx *gin.Context) {
	id := ctx.Param("id")

	if err := c.service.DeleteProduct(id); err != nil {
		if errors.Is(err, services.ErrProductNotFound) {
			respondError(ctx, http.StatusNotFound, "product not found")
			return
		}
		respondError(ctx, http.StatusInternalServerError, "failed to delete product")
		return
	}

	ctx.JSON(http.StatusOK, gin.H{
		"status":  "success",
		"message": "product deleted successfully",
	})
}

// --- helpers ---

func respondError(ctx *gin.Context, code int, message string) {
	ctx.JSON(code, gin.H{
		"status":  "error",
		"message": message,
	})
}

func parseIntQuery(ctx *gin.Context, key string, defaultVal int) int {
	if raw := ctx.Query(key); raw != "" {
		if v, err := strconv.Atoi(raw); err == nil && v > 0 {
			return v
		}
	}
	return defaultVal
}

func totalPages(total int64, limit int) int64 {
	if limit <= 0 {
		return 0
	}
	pages := total / int64(limit)
	if total%int64(limit) != 0 {
		pages++
	}
	return pages
}
