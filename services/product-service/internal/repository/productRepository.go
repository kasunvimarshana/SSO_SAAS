package repository

import (
	"product-service/internal/models"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

type ProductRepository interface {
	FindAll(filter models.ProductFilter) ([]models.Product, int64, error)
	FindByID(id uuid.UUID) (*models.Product, error)
	FindCategories() ([]string, error)
	Create(product *models.Product) error
	Update(product *models.Product) error
	Delete(id uuid.UUID) error
	ExistsBySKU(sku string, excludeID *uuid.UUID) (bool, error)
}

type productRepository struct {
	db *gorm.DB
}

func NewProductRepository(db *gorm.DB) ProductRepository {
	return &productRepository{db: db}
}

func (r *productRepository) FindAll(filter models.ProductFilter) ([]models.Product, int64, error) {
	var products []models.Product
	var total int64

	query := r.db.Model(&models.Product{})

	if filter.Category != "" {
		query = query.Where("category = ?", filter.Category)
	}
	if filter.Search != "" {
		search := "%" + filter.Search + "%"
		query = query.Where("name ILIKE ? OR description ILIKE ?", search, search)
	}
	if filter.MinPrice != nil {
		query = query.Where("price >= ?", *filter.MinPrice)
	}
	if filter.MaxPrice != nil {
		query = query.Where("price <= ?", *filter.MaxPrice)
	}

	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}

	offset := (filter.Page - 1) * filter.Limit
	if err := query.Offset(offset).Limit(filter.Limit).Order("created_at DESC").Find(&products).Error; err != nil {
		return nil, 0, err
	}

	return products, total, nil
}

func (r *productRepository) FindByID(id uuid.UUID) (*models.Product, error) {
	var product models.Product
	if err := r.db.First(&product, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &product, nil
}

func (r *productRepository) FindCategories() ([]string, error) {
	var categories []string
	if err := r.db.Model(&models.Product{}).
		Distinct("category").
		Where("is_active = true").
		Order("category ASC").
		Pluck("category", &categories).Error; err != nil {
		return nil, err
	}
	return categories, nil
}

func (r *productRepository) Create(product *models.Product) error {
	return r.db.Create(product).Error
}

func (r *productRepository) Update(product *models.Product) error {
	return r.db.Save(product).Error
}

func (r *productRepository) Delete(id uuid.UUID) error {
	return r.db.Delete(&models.Product{}, "id = ?", id).Error
}

func (r *productRepository) ExistsBySKU(sku string, excludeID *uuid.UUID) (bool, error) {
	query := r.db.Model(&models.Product{}).Where("sku = ?", sku)
	if excludeID != nil {
		query = query.Where("id != ?", *excludeID)
	}
	var count int64
	if err := query.Count(&count).Error; err != nil {
		return false, err
	}
	return count > 0, nil
}
