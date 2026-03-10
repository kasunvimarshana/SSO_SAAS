package config

import (
	"log"

	amqp "github.com/rabbitmq/amqp091-go"
)

const ProductEventsExchange = "product_events"

type RabbitMQ struct {
	Conn    *amqp.Connection
	Channel *amqp.Channel
}

func InitRabbitMQ(url string) *RabbitMQ {
	conn, err := amqp.Dial(url)
	if err != nil {
		log.Printf("warning: failed to connect to RabbitMQ: %v — events will not be published", err)
		return nil
	}

	ch, err := conn.Channel()
	if err != nil {
		log.Printf("warning: failed to open RabbitMQ channel: %v — events will not be published", err)
		conn.Close()
		return nil
	}

	if err := ch.ExchangeDeclare(
		ProductEventsExchange,
		"topic",
		true,
		false,
		false,
		false,
		nil,
	); err != nil {
		log.Printf("warning: failed to declare exchange: %v — events will not be published", err)
		ch.Close()
		conn.Close()
		return nil
	}

	log.Println("RabbitMQ connected and exchange declared")
	return &RabbitMQ{Conn: conn, Channel: ch}
}

func (r *RabbitMQ) Close() {
	if r == nil {
		return
	}
	if r.Channel != nil {
		r.Channel.Close()
	}
	if r.Conn != nil {
		r.Conn.Close()
	}
}
