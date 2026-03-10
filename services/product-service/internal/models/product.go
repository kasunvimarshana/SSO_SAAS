package models

import (
	"database/sql/driver"
	"encoding/json"
	"errors"
	"time"

	"github.com/google/uuid"
	"gorm.io/gorm"
)

// StringSlice is a JSONB-backed slice of strings.
type StringSlice []string

func (s StringSlice) Value() (driver.Value, error) {
	if s == nil {
		return "[]", nil
	}
	b, err := json.Marshal(s)
	return string(b), err
}

func (s *StringSlice) Scan(value interface{}) error {
	var raw []byte
	switch v := value.(type) {
	case string:
		raw = []byte(v)
	case []byte:
		raw = v
	default:
		return errors.New("unsupported type for StringSlice")
	}
	return json.Unmarshal(raw, s)
}

type Product struct {
	ID          uuid.UUID      `gorm:"type:uuid;primaryKey"                          json:"id"`
	Name        string         `gorm:"type:varchar(255);not null"                    json:"name"        binding:"required"`
	Description string         `gorm:"type:text"                                     json:"description"`
	Price       float64        `gorm:"type:decimal(10,2);not null"                   json:"price"       binding:"required,gt=0"`
	Category    string         `gorm:"type:varchar(100);not null;index"              json:"category"    binding:"required"`
	SKU         string         `gorm:"type:varchar(100);not null;uniqueIndex"        json:"sku"         binding:"required"`
	Images      StringSlice    `gorm:"type:jsonb;default:'[]'"                       json:"images"`
	IsActive    bool           `gorm:"default:true"                                  json:"is_active"`
	CreatedAt   time.Time      `                                                     json:"created_at"`
	UpdatedAt   time.Time      `                                                     json:"updated_at"`
	DeletedAt   gorm.DeletedAt `gorm:"index"                                         json:"-"`
}

func (p *Product) BeforeCreate(tx *gorm.DB) error {
	if p.ID == uuid.Nil {
		p.ID = uuid.New()
	}
	if p.Images == nil {
		p.Images = StringSlice{}
	}
	return nil
}

// CreateProductInput holds validated fields for product creation.
type CreateProductInput struct {
	Name        string      `json:"name"        binding:"required,min=1,max=255"`
	Description string      `json:"description"`
	Price       float64     `json:"price"       binding:"required,gt=0"`
	Category    string      `json:"category"    binding:"required,min=1,max=100"`
	SKU         string      `json:"sku"         binding:"required,min=1,max=100"`
	Images      StringSlice `json:"images"`
	IsActive    *bool       `json:"is_active"`
}

// UpdateProductInput holds validated fields for product updates (all optional).
type UpdateProductInput struct {
	Name        *string     `json:"name"        binding:"omitempty,min=1,max=255"`
	Description *string     `json:"description"`
	Price       *float64    `json:"price"       binding:"omitempty,gt=0"`
	Category    *string     `json:"category"    binding:"omitempty,min=1,max=100"`
	SKU         *string     `json:"sku"         binding:"omitempty,min=1,max=100"`
	Images      StringSlice `json:"images"`
	IsActive    *bool       `json:"is_active"`
}

// ProductFilter carries query-string filter parameters.
type ProductFilter struct {
	Page     int
	Limit    int
	Category string
	Search   string
	MinPrice *float64
	MaxPrice *float64
}
