package services

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"time"

	"github.com/google/uuid"
	amqp "github.com/rabbitmq/amqp091-go"
	"gorm.io/gorm"

	"product-service/internal/config"
	"product-service/internal/models"
	"product-service/internal/repository"
)

var (
	ErrProductNotFound  = errors.New("product not found")
	ErrDuplicateSKU     = errors.New("a product with this SKU already exists")
	ErrInvalidPriceRange = errors.New("min_price cannot be greater than max_price")
)

type ProductService interface {
	GetProducts(filter models.ProductFilter) ([]models.Product, int64, error)
	GetProductByID(id string) (*models.Product, error)
	GetCategories() ([]string, error)
	CreateProduct(input models.CreateProductInput) (*models.Product, error)
	UpdateProduct(id string, input models.UpdateProductInput) (*models.Product, error)
	DeleteProduct(id string) error
}

type productService struct {
	repo     repository.ProductRepository
	rabbitMQ *config.RabbitMQ
}

func NewProductService(repo repository.ProductRepository, mq *config.RabbitMQ) ProductService {
	return &productService{repo: repo, rabbitMQ: mq}
}

func (s *productService) GetProducts(filter models.ProductFilter) ([]models.Product, int64, error) {
	if filter.Page < 1 {
		filter.Page = 1
	}
	if filter.Limit < 1 || filter.Limit > 100 {
		filter.Limit = 10
	}
	if filter.MinPrice != nil && filter.MaxPrice != nil && *filter.MinPrice > *filter.MaxPrice {
		return nil, 0, ErrInvalidPriceRange
	}
	return s.repo.FindAll(filter)
}

func (s *productService) GetProductByID(id string) (*models.Product, error) {
	uid, err := uuid.Parse(id)
	if err != nil {
		return nil, ErrProductNotFound
	}
	product, err := s.repo.FindByID(uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProductNotFound
		}
		return nil, err
	}
	return product, nil
}

func (s *productService) GetCategories() ([]string, error) {
	return s.repo.FindCategories()
}

func (s *productService) CreateProduct(input models.CreateProductInput) (*models.Product, error) {
	exists, err := s.repo.ExistsBySKU(input.SKU, nil)
	if err != nil {
		return nil, err
	}
	if exists {
		return nil, ErrDuplicateSKU
	}

	isActive := true
	if input.IsActive != nil {
		isActive = *input.IsActive
	}

	images := input.Images
	if images == nil {
		images = models.StringSlice{}
	}

	product := &models.Product{
		Name:        input.Name,
		Description: input.Description,
		Price:       input.Price,
		Category:    input.Category,
		SKU:         input.SKU,
		Images:      images,
		IsActive:    isActive,
	}

	if err := s.repo.Create(product); err != nil {
		return nil, err
	}

	s.publishEvent("product.created", product)
	return product, nil
}

func (s *productService) UpdateProduct(id string, input models.UpdateProductInput) (*models.Product, error) {
	uid, err := uuid.Parse(id)
	if err != nil {
		return nil, ErrProductNotFound
	}

	product, err := s.repo.FindByID(uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, ErrProductNotFound
		}
		return nil, err
	}

	if input.SKU != nil && *input.SKU != product.SKU {
		exists, err := s.repo.ExistsBySKU(*input.SKU, &uid)
		if err != nil {
			return nil, err
		}
		if exists {
			return nil, ErrDuplicateSKU
		}
		product.SKU = *input.SKU
	}

	if input.Name != nil {
		product.Name = *input.Name
	}
	if input.Description != nil {
		product.Description = *input.Description
	}
	if input.Price != nil {
		product.Price = *input.Price
	}
	if input.Category != nil {
		product.Category = *input.Category
	}
	if input.Images != nil {
		product.Images = input.Images
	}
	if input.IsActive != nil {
		product.IsActive = *input.IsActive
	}

	if err := s.repo.Update(product); err != nil {
		return nil, err
	}

	s.publishEvent("product.updated", product)
	return product, nil
}

func (s *productService) DeleteProduct(id string) error {
	uid, err := uuid.Parse(id)
	if err != nil {
		return ErrProductNotFound
	}

	_, err = s.repo.FindByID(uid)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return ErrProductNotFound
		}
		return err
	}

	if err := s.repo.Delete(uid); err != nil {
		return err
	}

	s.publishEvent("product.deleted", map[string]string{"id": id})
	return nil
}

func (s *productService) publishEvent(routingKey string, payload interface{}) {
	if s.rabbitMQ == nil || s.rabbitMQ.Channel == nil {
		return
	}

	body, err := json.Marshal(map[string]interface{}{
		"event":     routingKey,
		"payload":   payload,
		"timestamp": time.Now().UTC(),
	})
	if err != nil {
		log.Printf("failed to marshal event %s: %v", routingKey, err)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	if err := s.rabbitMQ.Channel.PublishWithContext(
		ctx,
		config.ProductEventsExchange,
		routingKey,
		false,
		false,
		amqp.Publishing{
			ContentType:  "application/json",
			DeliveryMode: amqp.Persistent,
			Body:         body,
		},
	); err != nil {
		log.Printf("failed to publish event %s: %v", routingKey, err)
		return
	}

	fmt.Printf("published event: %s\n", routingKey)
}
